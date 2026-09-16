/**
 * @file scripts/seed-config.ts
 * @description Reprend depuis l'ancien `bot-discord/config.js` uniquement ce qui
 * doit rester identique après la migration (économie du jeu : items suivis,
 * objectifs de quota, taux de paie), plus les salons qui sont de simples flux
 * de logs FiveM externes en lecture seule (coffres, coffre admin, garages) —
 * sans risque de doublon puisque ce bot ne fait qu'y LIRE, jamais y poster.
 *
 * Volontairement PAS repris par ce script (choix explicite, voir plan de
 * migration) :
 *  - Les salons où l'ancien bot poste ses propres panneaux/alertes (stock,
 *    quotas, armurerie, taxes, ventes, alertes, historique, bilan, paie,
 *    labos...) — **y compris `admin`**, qui malgré son nom n'est PAS un
 *    simple flux de logs à lire : le bot y POSTE de vraies alertes (fourrière,
 *    joueur non mappé, taxes expirées). Le réutiliser tel quel ferait risquer
 *    de poster de vraies alertes dans le salon admin réel pendant les tests
 *    (constaté lors de la Phase 4 : bien vérifier qu'aucune n'a fuité avant de
 *    corriger). Comme les autres panneaux, `admin` doit être un salon dédié
 *    créé via `/config category set`, à la main.
 *  - `/config type-groupe` : le tier par défaut `petite_frappe` reproduit déjà
 *    BRAQUAGE_LIMITS (fleeca/armurerie 6, bijouterie/pinebank 1) — vérifié
 *    dans le CLAUDE.md du nouveau projet, rien à faire.
 *  - Les cooldowns (atm/cambu/superette/gofast) : fixés en dur côté nouveau
 *    projet (config-store.ts, ACTIVITY_TYPES_FIXED) sur exactement les mêmes
 *    durées que COOLDOWNS dans l'ancien config.js (3h/3h/2h/24h) — vérifié,
 *    rien à faire.
 *  - MUNITIONS_FABRICATION_QUOTA_HEBDO, MONTANT_FOURRIERE : fixés en dur des
 *    deux côtés à la même valeur (5000, 350) — vérifié, rien à faire.
 *
 * Idempotent : relançable sans risque (upsert partout).
 *
 * IMPORTANT : le bot déjà démarré ne relit pas cette config tout seul (cache
 * en mémoire par process) — faire `docker compose restart` après ce script
 * pour qu'elle soit prise en compte.
 *
 * Usage : GUILD_ID=... npm run seed-config
 */
import 'dotenv/config';
import * as db from '../src/db';

const GUILD_ID = process.env.GUILD_ID;

// ─── Recopié tel quel depuis bot-discord/config.js (source de vérité originale) ──
const OLD_CONFIG = {
  CHANNELS: {
    logs_coffres: ['1489349973643493457', '1491436345912983713', '1460236012860211264', '1489351144345178324', '1516189818365935616', '1502234747441643660', '1502262871784951848', '1504786258126311515', '1504789101084147863', '1528884753556701356', '1528884847618297867', '1548286835032326175'],
    coffre_admin: '1528884847618297867',
    // Coffres qui sont AUSSI des coffres admin, EN PLUS de rester dans
    // logs_coffres (contrairement à coffre_admin ci-dessus, qui lui n'est
    // QUE admin) — un même salon peut être surveillé sous les deux rôles.
    coffres_admin_supplementaires: ['1548286835032326175'],
    logs_garages: '1451557886219259924',
  },
  // Ordre EXACT de l'ancien ALLOWED_ITEMS (bot-discord/config.js) — c'est
  // l'ordre auquel les membres sont déjà habitués dans le panneau Stock
  // Général, pas un ordre alphabétique ni "les items par défaut d'abord"
  // (Argent Sale/Argent sont en tête dans l'ancien bot, mais Munition de
  // pistolet tout à la fin — aucune règle uniforme, juste cet ordre précis).
  // `display_order` reprend cet index tel quel.
  VENTE_PNJ_ITEMS: [
    'Cannabis', 'Carte Prépayée', 'B-magic', 'Pochon De Mexicana', 'Ecstasy', 'Tranq', 'Cocaïne', 'Meth bleue',
    'Cocaine Pure À 50', 'Cocaine Pure À 70', 'Cocaine Pure À 90', 'Cocaine Pure À 99',
    'Cannabis Pure À 50', 'Cannabis Pure À 70', 'Cannabis Pure À 90', 'Cannabis Pure À 99',
    'Mexicana Pure À 50', 'Mexicana Pure À 70', 'Mexicana Pure À 90', 'Mexicana Pure À 99',
    // Nouveau (labo Salvia, Indépendant uniquement) — contrairement à
    // Cannabis/Mexicana/Cocaïne, PAS liée à son labo (voir LABO_LIE_BY_ITEM) :
    // les Indépendants peuvent la vendre au PNJ même en la produisant.
    'Salvia',
  ],
  // Items suivis SANS le groupe "Drogue à vendre", en excluant ceux déjà
  // pré-remplis par défaut côté nouveau projet (Munition de pistolet, Argent
  // Sale, Argent — voir src/default-items.ts) : upsertItem écraserait leur
  // config par défaut (ex. le lien MUNITIONS_STOCK_GROUP) si on les retouchait ici.
  // 'Héroïne' n'était pas dans l'ancien ALLOWED_ITEMS (jamais tracké comme
  // item de stock, seulement comme activité/taxe 'heroine') — orthographe
  // confirmée explicitement par l'utilisateur, pas devinée (piège n°1).
  OTHER_ITEMS: [
    'Pochon De SporeX', 'Héroïne', 'Outil de crochettage', 'Boîtier de piratage', 'Perceuse',
    'Carte Piratage Fleeca', 'Psilocybe Rouge', 'Psilocybe Vert', 'Psilocybe Violet',
    'Datura', 'Morphine', 'Poudre à canon', 'Fragment de métal',
    // Nouveau (labo Branche De Cannabis, Indépendant uniquement, voir
    // LABO_LIE_BY_ITEM) — pas vendable au PNJ, comme Cannabis/Héroïne.
    'Branche de cannabis', 'Graine de strawberry', 'Pot de plantation', 'Fertilisant',
    // Matériau du labo Salvia (Indépendant) — contrairement à Salvia
    // elle-même, pas vendable au PNJ.
    'Feuilles de salvia',
  ],
  QUOTAS: { labos: 7, vente: 200, recolte: 1000, actions: 1 },
  SALAIRE_PAR_VENTE: 30,
  ADMIN_ROLE_ID: '1456989709627818100',
  TAXES_ROLE_ID: '1531629596909240400',
};

// Ordre d'affichage complet dans le panneau Stock Général : les 5 items
// pré-remplis par défaut (src/default-items.ts) groupés en tête, puis le
// reste dans l'ordre de l'ancien ALLOWED_ITEMS (bot-discord/config.js).
// `display_order` reprend l'index dans CETTE liste tel quel.
const ITEM_DISPLAY_ORDER: string[] = [
  // Les 5 items pré-remplis par défaut (src/default-items.ts) groupés en tête.
  'Argent Sale', 'Argent', 'Munition de pistolet', 'Boîte mun. pistolet', 'Munition de SMG',
  // Puis l'ordre de l'ancien ALLOWED_ITEMS (bot-discord/config.js), sans ses
  // 3 entrées ci-dessus (déjà placées) ni Argent/Argent Sale.
  'Cannabis', 'Carte Prépayée', 'B-magic', 'Pochon De Mexicana', 'Ecstasy', 'Tranq',
  'Cocaïne', 'Meth bleue', 'Pochon De SporeX', 'Héroïne',
  'Cocaine Pure À 50', 'Cocaine Pure À 70', 'Cocaine Pure À 90', 'Cocaine Pure À 99',
  'Cannabis Pure À 50', 'Cannabis Pure À 70', 'Cannabis Pure À 90', 'Cannabis Pure À 99',
  'Mexicana Pure À 50', 'Mexicana Pure À 70', 'Mexicana Pure À 90', 'Mexicana Pure À 99',
  'Salvia',
  'Outil de crochettage', 'Boîtier de piratage', 'Perceuse', 'Carte Piratage Fleeca',
  'Psilocybe Rouge', 'Psilocybe Vert', 'Psilocybe Violet',
  'Datura', 'Morphine', 'Poudre à canon', 'Fragment de métal',
  'Branche de cannabis', 'Graine de strawberry', 'Pot de plantation', 'Fertilisant',
  'Feuilles de salvia',
];

/** Items pré-remplis par défaut (src/default-items.ts) : leur `display_order` se met à jour sans toucher au reste de leur config (stock_group, multiplicateur...). */
const DEFAULT_SEEDED_ITEMS = new Set(['Argent Sale', 'Argent', 'Munition de pistolet', 'Boîte mun. pistolet', 'Munition de SMG']);

/**
 * Lien item → labo (`labo_lie`/`labo_lie_role`, voir docstring du modèle
 * Item côté schema.prisma) :
 *  - role 'produit' : CE labo produit cet item — exclut la vente PNJ pour un
 *    tier où ce labo est actif (voir `config-store.ts`, reload()). Uniquement
 *    l'item BRUT (Cannabis/Pochon De Mexicana/Cocaïne/Pochon De SporeX/
 *    Héroïne/Branche de cannabis), pas ses versions purifiées (quand il y en
 *    a), qui restent donc toujours vendables au PNJ quel que soit le tier.
 *    Sporex/Héroïne/Branche de cannabis n'ont de toute façon jamais été
 *    vendables au PNJ (`vente: false`, comme dans l'ancien bot pour
 *    Sporex/Héroïne) : le lien ici ne fait que les faire apparaître en
 *    "Drogues de production" quand leur labo est actif (Petite Frappe pour
 *    Sporex/Héroïne, Indépendant pour Branche de cannabis).
 *  - role 'materiau' : CE labo consomme cet item comme matière première —
 *    aucun effet sur la vente PNJ (ces items ne sont de toute façon jamais
 *    vendables), juste l'apparition en "Matériaux de production" quand ce
 *    labo est actif. Matériaux Sporex/Héroïne (Petite Frappe) et Branche de
 *    cannabis (Indépendant) donnés par l'utilisateur les 14 et 15/09.
 * Carte Prépayée/B-magic/Ecstasy/Tranq/Meth bleue n'ont aucun labo
 * correspondant dans ce bot : elles restent vendables au PNJ quel que soit
 * le tier, absentes de cette table.
 */
const LABO_LIE_BY_ITEM: Record<string, { labo: string; role: 'produit' | 'materiau' }> = {
  Cannabis: { labo: 'labo_cannabis', role: 'produit' },
  'Pochon De Mexicana': { labo: 'labo_mexicana', role: 'produit' },
  Cocaïne: { labo: 'labo_cocaine', role: 'produit' },
  'Pochon De SporeX': { labo: 'labo_sporex', role: 'produit' },
  Héroïne: { labo: 'labo_heroine', role: 'produit' },
  'Psilocybe Rouge': { labo: 'labo_sporex', role: 'materiau' },
  'Psilocybe Vert': { labo: 'labo_sporex', role: 'materiau' },
  'Psilocybe Violet': { labo: 'labo_sporex', role: 'materiau' },
  'Poudre à canon': { labo: 'labo_sporex', role: 'materiau' },
  'Fragment de métal': { labo: 'labo_sporex', role: 'materiau' },
  Datura: { labo: 'labo_heroine', role: 'materiau' },
  Morphine: { labo: 'labo_heroine', role: 'materiau' },
  'Branche de cannabis': { labo: 'labo_branche_cannabis', role: 'produit' },
  'Graine de strawberry': { labo: 'labo_branche_cannabis', role: 'materiau' },
  'Pot de plantation': { labo: 'labo_branche_cannabis', role: 'materiau' },
  Fertilisant: { labo: 'labo_branche_cannabis', role: 'materiau' },
  'Feuilles de salvia': { labo: 'labo_salvia', role: 'materiau' },
};

async function main(): Promise<void> {
  if (!GUILD_ID) {
    console.error('❌ GUILD_ID manquant (variable d\'environnement).');
    process.exit(1);
  }

  // ── Salons : logs coffre (hors coffre admin) + coffre admin + garages ──────
  // `admin` n'est PAS repris ici (voir docstring de fichier) : à créer comme
  // les autres panneaux via `/config category set`.
  const coffreAdmin = OLD_CONFIG.CHANNELS.coffre_admin;
  for (const channelId of OLD_CONFIG.CHANNELS.logs_coffres) {
    const role = channelId === coffreAdmin ? 'logs_coffres_admin' : 'logs_coffres';
    await db.addChannelToRole(GUILD_ID, role, channelId);
  }
  // Coffres admin supplémentaires : restent aussi dans logs_coffres (déjà
  // fait ci-dessus), simplement ajoutés en plus à logs_coffres_admin.
  for (const channelId of OLD_CONFIG.CHANNELS.coffres_admin_supplementaires) {
    await db.addChannelToRole(GUILD_ID, 'logs_coffres_admin', channelId);
  }
  await db.setChannelRole(GUILD_ID, 'logs_garages', OLD_CONFIG.CHANNELS.logs_garages);
  console.log(`✅ Salons : ${OLD_CONFIG.CHANNELS.logs_coffres.length} coffre(s) (dont 1 admin), garages.`);

  // ── Rôles ────────────────────────────────────────────────────────────────
  await db.setDiscordRole(GUILD_ID, 'admin', OLD_CONFIG.ADMIN_ROLE_ID);
  await db.setDiscordRole(GUILD_ID, 'taxes', OLD_CONFIG.TAXES_ROLE_ID);
  console.log('✅ Rôles admin + taxes.');

  // ── Items vendables au PNJ ────────────────────────────────────────────────
  for (const name of OLD_CONFIG.VENTE_PNJ_ITEMS) {
    const lien = LABO_LIE_BY_ITEM[name];
    await db.upsertItem(GUILD_ID, {
      name,
      vente: true,
      display_order: ITEM_DISPLAY_ORDER.indexOf(name),
      labo_lie: lien?.labo ?? null,
      labo_lie_role: lien?.role ?? null,
    });
  }
  // ── Items restants (pas de vente PNJ) ────────────────────────────────────
  for (const name of OLD_CONFIG.OTHER_ITEMS) {
    const lien = LABO_LIE_BY_ITEM[name];
    await db.upsertItem(GUILD_ID, {
      name,
      vente: false,
      display_order: ITEM_DISPLAY_ORDER.indexOf(name),
      labo_lie: lien?.labo ?? null,
      labo_lie_role: lien?.role ?? null,
    });
  }
  console.log(`✅ Items : ${OLD_CONFIG.VENTE_PNJ_ITEMS.length + OLD_CONFIG.OTHER_ITEMS.length} (hors Munition de pistolet/Argent Sale/Argent déjà pré-remplis par défaut).`);

  // ── Ordre d'affichage des items déjà pré-remplis par défaut ─────────────
  // Mise à jour ciblée du seul champ display_order, sans passer par
  // upsertItem (qui écraserait leur stock_group/multiplicateur par défaut).
  for (const name of DEFAULT_SEEDED_ITEMS) {
    await db.prisma.item.updateMany({
      where: { guildId: GUILD_ID, name },
      data: { displayOrder: ITEM_DISPLAY_ORDER.indexOf(name) },
    });
  }
  console.log(`✅ Ordre d'affichage appliqué à ${ITEM_DISPLAY_ORDER.length} items au total.`);

  // ── Objectifs de quota ────────────────────────────────────────────────────
  for (const [quotaType, valeur] of Object.entries(OLD_CONFIG.QUOTAS)) {
    await db.setQuotaTarget(GUILD_ID, quotaType, valeur);
  }
  console.log('✅ Objectifs de quota :', OLD_CONFIG.QUOTAS);

  // ── Taux de paie (uniquement vente dans l'ancien bot) ────────────────────
  await db.setSalaryRate(GUILD_ID, 'vente', OLD_CONFIG.SALAIRE_PAR_VENTE);
  console.log(`✅ Taux de paie : vente = ${OLD_CONFIG.SALAIRE_PAR_VENTE}$/unité.`);

  console.log('\n✅ Seed config terminé — pense à "docker compose restart" pour que le bot déjà démarré recharge sa config.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => db.prisma.$disconnect());
