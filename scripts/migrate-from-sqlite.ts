/**
 * @file scripts/migrate-from-sqlite.ts
 * @description Migration ponctuelle des données de l'ancien bot (`bot-discord`,
 * CommonJS + better-sqlite3, un seul serveur) vers ce projet (TypeScript +
 * Prisma/PostgreSQL, multi-tenant). Toutes les lignes migrées sont rattachées
 * à `GUILD_ID` (`.env`) — la seule guilde connue au moment de cette migration,
 * même principe que `backfill-guild-id.ts`.
 *
 * Tables volontairement PAS migrées (voir plan de migration) :
 *  - `drogue_bourse`, `zone_bonus` : fonctionnalités abandonnées, absentes de
 *    ce projet. Historique consultable uniquement dans l'ancienne base.
 *  - `settings` : seules `last_weekly_reset` et les `labo_end_*` (minuteurs de
 *    labo en cours) sont reprises — le reste (IDs de messages permanents de
 *    l'ancien bot) n'a aucun sens ici, les panneaux sont recréés au premier
 *    `/config channel set` sur ce projet.
 *
 * IDs préservés : les tables à clé auto-incrémentée (transactions, taxes,
 * armurerie, pending_sales, fourrieres, braquages, stock_history,
 * munitions_ventes) sont insérées avec leur `id` d'origine — des messages
 * Discord déjà envoyés référencent ces IDs dans leur titre/footer (ex.
 * "Vente #584", "Transaction #686") et doivent continuer à les résoudre après
 * bascule. La séquence Postgres de chaque table est réalignée sur le MAX(id)
 * une fois l'insertion terminée, sinon le prochain INSERT auto-généré
 * entrerait en collision avec un ID repris de l'ancienne base.
 *
 * Idempotence : PAS idempotent sur les tables à ID préservé (un deuxième
 * passage échouerait sur les clés primaires déjà présentes) — prévu pour être
 * lancé sur une base cible VIDE à chaque fois (voir plan : rejoué une dernière
 * fois juste avant la bascule finale, sur une base fraîche).
 *
 * Usage : SQLITE_PATH=/chemin/vers/data.db npm run migrate-from-sqlite
 *         (SQLITE_PATH par défaut : /home/debian/bot-discord/data.db)
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { prisma } from '../src/db';

const GUILD_ID = process.env.GUILD_ID;
const SQLITE_PATH = process.env.SQLITE_PATH || '/home/debian/bot-discord/data.db';

/** Tables à clé auto-incrémentée dont l'ID d'origine est préservé — voir docstring de fichier. */
const AUTOINCREMENT_TABLES = [
  'transactions', 'stock_history', 'braquages', 'taxes', 'armurerie',
  'pending_sales', 'fourrieres', 'munitions_ventes',
] as const;

function toDate(ms: number | null): Date | null {
  return ms === null || ms === undefined ? null : new Date(ms);
}

function toBool(v: number | null): boolean {
  return !!v;
}

/**
 * L'ancien bot stockait le LIBELLÉ du type d'arme (ex. "Glock", tel quel
 * depuis config.js `ARME_TYPES`) dans `armurerie.type`. Le nouveau projet y
 * stocke la CLÉ interne (ex. "glock" — voir la docstring en tête de
 * `src/modules/armurerie.ts` : "le champ type stocké en base est la CLÉ du
 * type, pas son libellé affiché"). Sans cette table de correspondance, migrer
 * le libellé tel quel ne correspond à aucune clé connue et toutes les armes
 * tombent dans "Sans type" à l'affichage — bug constaté lors de la Phase 4.
 * Les 4 entrées commentées n'ont pas d'équivalent dans le nouveau
 * `ARME_TYPES` (catégories consolidées différemment) ; aucune arme réelle de
 * la base actuelle ne les utilise (vérifié), elles tomberont dans "Sans type"
 * si un jour une arme de ce type existe.
 */
const ARME_TYPE_LABEL_TO_KEY: Record<string, string> = {
  'Pistolet artisanal': 'pistolet_artisanal',
  'SNS': 'sns',
  'SNS PICO': 'sns_pico',
  'Colt': 'colt',
  'P88': 'p88',
  'Beretta': 'beretta',
  'Glock': 'glock',
  'Glock 17': 'glock_17',
  'Pistolet en céramique': 'pistolet_en_ceramique',
  'Calibre 50': 'calibre_50',
  'Berreta (Pistolet MK2)': 'berreta_mk2',
  'Pistolet Lourd': 'pistolet_lourd',
  'Revolver': 'revolver',
  'Fusil à canon scié': 'fusil_a_canon_scie',
  'Fusil à pompe': 'fusil_a_pompe',
  'Striker 12': 'striker_12',
  'Fusil à pompe d’assaut': 'fusil_a_pompe_dassaut',
  'Fusil à double canon': 'fusil_a_double_canon',
  'Mini SMG': 'mini_smg',
  'Micro SMG': 'micro_smg',
  'TEC9': 'tec9',
  'Mini Uzi Tactic': 'mini_uzi_tactic',
  'MAC-10': 'mac_10',
  'Mp5k': 'mp5k',
  'Mitraillette Tactique': 'mitraillette_tactique',
  'Vesper 9': 'vesper_9',
  // 'Mitraillette d’assaut' : pas d'équivalent dans le nouveau ARME_TYPES.
  // 'Mitraillette' : pas d'équivalent.
  'Vortex SMG': 'vortex_smg',
  'Fusil compact': 'fusil_compact',
  'UMP 45': 'ump_45',
  'SG552': 'sg552',
  'Fusil lourd': 'fusil_lourd',
  'Thompson': 'thompson',
  'AK47': 'ak47',
  'UMP 45 CHR': 'ump_45_chr',
  'Mk Priss': 'mk_priss',
  'AR 7': 'ar_7',
  // 'Fusil bullpup' : pas d'équivalent.
  // 'Fusil de combat' : pas d'équivalent.
};

function toArmeTypeKey(oldLabel: string | null): string | null {
  if (!oldLabel) return null;
  const key = ARME_TYPE_LABEL_TO_KEY[oldLabel];
  if (!key) {
    console.warn(`⚠️  Type d'arme sans équivalent dans le nouveau projet : "${oldLabel}" — l'arme tombera dans "Sans type".`);
    return null;
  }
  return key;
}

/**
 * Même piège que pour l'armurerie (voir {@link toArmeTypeKey}) : l'ancien bot
 * ne suivait qu'UNE seule zone, sous la clé fixe 'roxwood' (voir
 * `bot-discord/modules/taxes.js`). Le nouveau projet généralise en plusieurs
 * zones par tier d'organisation et attend la clé SLUGIFIÉE du libellé exact
 * (`slugifyZone` dans `src/modules/taxes.ts`) — "Roxwood Village" (zone du
 * tier par défaut `petite_frappe`, seul tier utilisé jusqu'ici) devient
 * `roxwood_village`. Sans cette traduction, les taxes migrées affichent
 * "roxwood" comme un type distinct et non résolu à côté de "Roxwood Village"
 * dans les menus de recherche — bug constaté lors de la Phase 4. Les 3 autres
 * types (fertilisant/sporex/vente) sont des types FIXES, pas des zones : leurs
 * clés sont identiques des deux côtés, rien à traduire pour eux.
 */
const TAXE_TYPE_TRANSLATION: Record<string, string> = {
  roxwood: 'roxwood_village',
};

function toTaxeType(oldType: string): string {
  return TAXE_TYPE_TRANSLATION[oldType] ?? oldType;
}

async function fixSequence(table: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`,
  );
}

async function main(): Promise<void> {
  if (!GUILD_ID) {
    console.error('❌ GUILD_ID manquant (variable d\'environnement) — impossible de savoir à quelle guilde rattacher les données migrées.');
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  console.log(`Migration de "${SQLITE_PATH}" vers la guilde ${GUILD_ID}...\n`);

  await prisma.guild.upsert({
    where: { guildId: GUILD_ID },
    update: {},
    create: { guildId: GUILD_ID, name: 'Famille Moni | Flashback FA' },
  });

  const counts: Record<string, number> = {};

  // ── stocks (clé composite, pas d'auto-increment) ─────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM stocks').all() as any[];
    for (const r of rows) {
      await prisma.stock.upsert({
        where: { guildId_item: { guildId: GUILD_ID, item: r.item } },
        update: { quantite: r.quantite },
        create: { guildId: GUILD_ID, item: r.item, quantite: r.quantite },
      });
    }
    counts.stocks = rows.length;
  }

  // ── stock_history ─────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM stock_history').all() as any[];
    for (const r of rows) {
      await prisma.stockHistory.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          timestamp: toDate(r.timestamp)!,
          joueur: r.joueur,
          action: r.action,
          item: r.item,
          quantite: r.quantite,
          stockAvant: r.stock_avant,
          stockApres: r.stock_apres,
          channelId: null, // absent de l'ancienne base (ajouté plus tard côté nouveau projet)
        },
      });
    }
    await fixSequence('stock_history');
    counts.stock_history = rows.length;
  }

  // ── transactions ──────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM transactions').all() as any[];
    for (const r of rows) {
      await prisma.transaction.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          userId: r.user_id,
          username: r.username || '',
          action: r.action,
          quantite: r.quantite,
          type: r.type,
          partenaires: r.partenaires || '[]',
          tempsRestant: r.temps_restant,
          timestamp: toDate(r.timestamp)!,
          deleted: toBool(r.deleted),
          deletedBy: r.deleted_by,
        },
      });
    }
    await fixSequence('transactions');
    counts.transactions = rows.length;
  }

  // ── stats (clé composite) ────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM stats').all() as any[];
    for (const r of rows) {
      await prisma.stat.upsert({
        where: { guildId_userId_action: { guildId: GUILD_ID, userId: r.user_id, action: r.action } },
        update: { count: r.count, points: r.points },
        create: { guildId: GUILD_ID, userId: r.user_id, action: r.action, count: r.count, points: r.points },
      });
    }
    counts.stats = rows.length;
  }

  // ── cooldowns (clé composite) ────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM cooldowns').all() as any[];
    for (const r of rows) {
      await prisma.cooldown.upsert({
        where: { guildId_userId_action: { guildId: GUILD_ID, userId: r.user_id, action: r.action } },
        update: { expiresAt: toDate(r.expires_at)!, notified: toBool(r.notified) },
        create: { guildId: GUILD_ID, userId: r.user_id, action: r.action, expiresAt: toDate(r.expires_at)!, notified: toBool(r.notified) },
      });
    }
    counts.cooldowns = rows.length;
  }

  // ── braquages ─────────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM braquages').all() as any[];
    for (const r of rows) {
      await prisma.braquage.create({
        data: { id: r.id, guildId: GUILD_ID, userId: r.user_id, action: r.action, timestamp: toDate(r.timestamp)! },
      });
    }
    await fixSequence('braquages');
    counts.braquages = rows.length;
  }

  // ── taxes ─────────────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM taxes').all() as any[];
    for (const r of rows) {
      await prisma.taxe.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          nom: r.nom,
          type: toTaxeType(r.type),
          telephone: r.telephone,
          echeance: toDate(r.echeance)!,
          motDePasse: r.mot_de_passe,
          actif: toBool(r.actif),
          alerteSent: toBool(r.alerte_sent),
          paye: toBool(r.paye),
        },
      });
    }
    await fixSequence('taxes');
    counts.taxes = rows.length;
  }

  // ── armurerie ─────────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM armurerie').all() as any[];
    for (const r of rows) {
      await prisma.arme.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          nom: r.nom,
          reference: r.reference,
          statut: r.statut,
          preteeA: r.pretee_a,
          type: toArmeTypeKey(r.type),
        },
      });
    }
    await fixSequence('armurerie');
    counts.armurerie = rows.length;
  }

  // ── user_mapping (clé composite) ─────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM user_mapping').all() as any[];
    for (const r of rows) {
      await prisma.userMapping.upsert({
        where: { guildId_gameName_discordId: { guildId: GUILD_ID, gameName: r.game_name, discordId: r.discord_id } },
        update: {},
        create: { guildId: GUILD_ID, gameName: r.game_name, discordId: r.discord_id },
      });
    }
    counts.user_mapping = rows.length;
  }

  // ── pending_sales ─────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM pending_sales').all() as any[];
    for (const r of rows) {
      await prisma.pendingSale.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          joueur: r.joueur,
          discordId: r.discord_id,
          item: r.item,
          quantite: r.quantite,
          timestamp: toDate(r.timestamp)!,
          statut: r.statut,
          montant: r.montant,
          prixPochon: r.prix_pochon,
          messageId: r.message_id,
          channelId: r.channel_id,
          confirmed: toBool(r.confirmed),
        },
      });
    }
    await fixSequence('pending_sales');
    counts.pending_sales = rows.length;
  }

  // ── vehicules (clé = plaque, pas d'auto-increment) ───────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM vehicules').all() as any[];
    for (const r of rows) {
      await prisma.vehicule.upsert({
        where: { guildId_plaque: { guildId: GUILD_ID, plaque: r.plaque } },
        update: { modele: r.modele, discordId: r.discord_id, joueur: r.joueur, timestamp: toDate(r.timestamp)! },
        create: { guildId: GUILD_ID, plaque: r.plaque, modele: r.modele, discordId: r.discord_id, joueur: r.joueur, timestamp: toDate(r.timestamp)! },
      });
    }
    counts.vehicules = rows.length;
  }

  // ── fourrieres ────────────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM fourrieres').all() as any[];
    for (const r of rows) {
      await prisma.fourriere.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          discordId: r.discord_id,
          joueur: r.joueur,
          plaque: r.plaque,
          modele: r.modele,
          timestamp: toDate(r.timestamp)!,
        },
      });
    }
    await fixSequence('fourrieres');
    counts.fourrieres = rows.length;
  }

  // ── munitions_ventes ──────────────────────────────────────────────────────
  {
    const rows = sqlite.prepare('SELECT * FROM munitions_ventes').all() as any[];
    for (const r of rows) {
      await prisma.munitionVente.create({
        data: {
          id: r.id,
          guildId: GUILD_ID,
          timestamp: toDate(r.timestamp)!,
          vendeurId: r.vendeur_id,
          vendeurUsername: r.vendeur_username || '',
          acheteurId: r.acheteur_id,
          quantite: r.quantite,
          prix: r.prix,
        },
      });
    }
    await fixSequence('munitions_ventes');
    counts.munitions_ventes = rows.length;
  }

  // ── settings : uniquement last_weekly_reset + minuteurs de labo en cours ──
  {
    const rows = sqlite.prepare(
      "SELECT * FROM settings WHERE key = 'last_weekly_reset' OR key LIKE 'labo_end_%'",
    ).all() as any[];
    for (const r of rows) {
      await prisma.setting.upsert({
        where: { guildId_key: { guildId: GUILD_ID, key: r.key } },
        update: { value: r.value },
        create: { guildId: GUILD_ID, key: r.key, value: r.value },
      });
    }
    counts.settings = rows.length;
  }

  console.log('Lignes migrées par table :');
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`);
  console.log('\n✅ Migration terminée.');

  sqlite.close();
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
