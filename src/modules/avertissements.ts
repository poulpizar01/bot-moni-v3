/**
 * @file src/modules/avertissements.ts
 * @description Panneau permanent des avertissements disciplinaires (salon
 * `avertissements`) : les admins en déclarent (personne, date, raison) et en
 * retirent, tout le monde consulte la liste directement dans l'embed.
 *
 * Le numéro d'un avertissement ("2ᵉ avertissement de X") n'est jamais
 * stocké : c'est son rang parmi ceux de la personne, par date puis par ordre
 * de saisie (voir `db.addAvertissement`). Retirer un avertissement renumérote
 * donc les suivants tout seul.
 *
 * Une saisie peut viser plusieurs personnes à la fois (même date, même
 * raison) : chacune reçoit son propre avertissement, avec son propre numéro.
 * Chaque personne avertie est pingée dans le salon par un message explicatif
 * supprimé 12h plus tard — l'échéance est gardée en base (`PINGS_KEY`) et
 * traitée par un cron (`deleteExpiredPings`), pas par un minuteur en mémoire
 * qu'un redémarrage ferait oublier.
 *
 * Seul un porteur du rôle membre (`/config role set membre`) peut être
 * averti, et ses avertissements sont purgés dès qu'il perd ce rôle ou quitte
 * le serveur — il ne fait plus partie du groupe (`handleMemberUpdate`,
 * `handleMemberLeave`, et `reconcile` au démarrage pour ce qui s'est passé
 * pendant que le bot était arrêté). Sans rôle membre configuré, rien n'est
 * jamais purgé et tout membre du serveur peut être averti.
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type ButtonInteraction, type Client, type GuildMember, type ModalSubmitInteraction,
  type PartialGuildMember, type StringSelectMenuInteraction, type UserSelectMenuInteraction,
} from 'discord.js';
import * as db from '../db';
import * as configStore from '../config-store';
import { isAdmin } from '../permissions';
import { upsertPanel } from '../permanent-message';
import { buildChunkedEmbeds, type EmbedChunkSection } from '../embed-chunks';
import { parisWallClock, parisWallToUtc } from '../paris-time';
import { SerialRunner } from '../serial';

const PANEL_TITLE = '⚠️ Avertissements';
const PANEL_SETTING_KEY = 'avertissements_message_id';
const RAISON_MAX = 300;
const MAX_PERSONNES = 25;

const PINGS_KEY = 'avertissements_pings';
const PING_DURATION_MS = 12 * 60 * 60 * 1000;
interface PendingPing { channelId: string; messageId: string; deleteAt: number }
/** Les lectures-écritures de la liste `PINGS_KEY` d'une guilde passent une par une. */
const pingsQueue = new SerialRunner();

/**
 * Personnes choisies dans le menu, en attente du formulaire : l'identifiant
 * d'un modal est limité à 100 caractères, trop peu pour 25 IDs Discord.
 * Perdu si le bot redémarre entre les deux — l'admin recommence la saisie.
 */
const selections = new Map<string, { userIds: string[]; ignores: string[]; expiresAt: number }>();
const SELECTION_TTL_MS = 15 * 60 * 1000;

/** Discord limite aussi le TOTAL des embeds d'un même message (6000 caractères) : 5 × 1100 reste dessous. */
const PANEL_CHUNKS = { charBudget: 1100, maxEmbeds: 5 };

function ordinal(n: number): string {
  return n === 1 ? '1er' : `${n}e`;
}

function formatDate(ms: number): string {
  const d = parisWallClock(new Date(ms));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** `JJ/MM/AAAA` → midi heure de Paris ce jour-là (pas minuit : aucun décalage horaire ne fait changer de jour). `null` si la date n'existe pas. */
function parseDate(raw: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return parisWallToUtc(year, month - 1, day, 12);
}

/** Peut-on avertir ce membre ? Le rôle membre s'il est configuré, sinon n'importe quel membre humain. */
function estAvertissable(guildId: string, member: GuildMember): boolean {
  if (member.user.bot) return false;
  const roleId = configStore.get(guildId).MEMBER_ROLE_ID;
  return !roleId || member.roles.cache.has(roleId);
}

// ─── PANNEAU ──────────────────────────────────────────────────────────────────

export async function initPermanentMessage(client: Client, guildId: string): Promise<void> {
  const channelId = configStore.get(guildId).CHANNELS.avertissements;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()) return;

    const rows = await db.getAllAvertissements(guildId);
    const parPersonne = new Map<string, db.AvertissementRow[]>();
    for (const row of rows) {
      const list = parPersonne.get(row.userId) ?? [];
      list.push(row);
      parPersonne.set(row.userId, list);
    }

    const guild = client.guilds.cache.get(guildId);
    const ids = [...parPersonne.keys()];
    if (guild && ids.length) await guild.members.fetch({ user: ids }).catch(() => null);
    const nom = (userId: string) => guild?.members.cache.get(userId)?.displayName ?? 'Inconnu';

    const sections: EmbedChunkSection[] = [...parPersonne.entries()]
      .sort(([a, la], [b, lb]) => lb.length - la.length || nom(a).localeCompare(nom(b)))
      .map(([userId, list]) => ({
        header: `**${nom(userId)}** (<@${userId}>) — ${list.length} avertissement${list.length > 1 ? 's' : ''}`,
        lines: list.map((a, i) => `\`#${i + 1}\` ${formatDate(a.date)} — ${a.raison}`),
      }));

    const intro =
      'Les admins déclarent et retirent les avertissements avec les boutons ci-dessous.\n' +
      'Ils sont purgés automatiquement quand une personne perd le rôle membre ou quitte le serveur.';
    const embeds = buildChunkedEmbeds(sections, {
      title: PANEL_TITLE,
      color: 0xE67E22,
      emptyDescription: `${intro}\n\n*Aucun avertissement en cours.*`,
      ...PANEL_CHUNKS,
    });
    if (sections.length) embeds[0].setDescription(`${intro}\n\n${embeds[0].data.description ?? ''}`);
    embeds[embeds.length - 1].setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('avert_ajouter').setLabel('Ajouter un avertissement').setStyle(ButtonStyle.Danger).setEmoji('⚠️'),
      new ButtonBuilder().setCustomId('avert_retirer').setLabel('Retirer un avertissement').setStyle(ButtonStyle.Secondary).setEmoji('🗑️'),
    );

    await upsertPanel(channel, guildId, PANEL_SETTING_KEY, PANEL_TITLE, async () => ({ embeds, components: [row] }));
  } catch (err) {
    console.error(`[avertissements] initPermanentMessage(${guildId}):`, (err as Error).message);
  }
}

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────

async function refuserSiPasAdmin(interaction: ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (isAdmin(interaction.guildId!, interaction.member)) return false;
  await interaction.reply({ content: '❌ Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
  return true;
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const ajout = interaction.customId === 'avert_ajouter';
  const select = new UserSelectMenuBuilder()
    .setCustomId(ajout ? 'avert_select_ajout' : 'avert_select_retrait')
    .setPlaceholder(ajout ? 'Personne(s) à avertir' : 'Personne concernée')
    .setMinValues(1).setMaxValues(ajout ? MAX_PERSONNES : 1);
  await interaction.reply({
    content: ajout ? 'Qui reçoit l\'avertissement ? (une ou plusieurs personnes — même date et même raison pour toutes)' : 'De qui retirer un avertissement ?',
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const guildId = interaction.guildId!;

  if (interaction.customId === 'avert_select_ajout') {
    const members = await interaction.guild!.members.fetch({ user: interaction.values }).catch(() => null);
    const retenus = interaction.values.filter(id => { const m = members?.get(id); return !!m && estAvertissable(guildId, m); });
    if (!retenus.length) {
      await interaction.update({ content: '❌ Seul un membre du groupe (rôle membre) peut recevoir un avertissement.', components: [] });
      return;
    }
    const now = Date.now();
    for (const [key, sel] of selections) if (sel.expiresAt < now) selections.delete(key);
    const ignores = interaction.values.filter(id => !retenus.includes(id));
    selections.set(interaction.id, { userIds: retenus, ignores, expiresAt: now + SELECTION_TTL_MS });

    const titre = retenus.length === 1 ? `Avertissement — ${members!.get(retenus[0])!.displayName}` : `Avertissement — ${retenus.length} personnes`;
    const modal = new ModalBuilder().setCustomId(`modal_avert_ajout:${interaction.id}`).setTitle(titre.slice(0, 45));
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('date').setLabel('Date (JJ/MM/AAAA)').setStyle(TextInputStyle.Short)
          .setRequired(true).setMaxLength(10).setValue(formatDate(now)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('raison').setLabel('Raison').setStyle(TextInputStyle.Paragraph)
          .setRequired(true).setMaxLength(RAISON_MAX),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  const userId = interaction.values[0];
  const list = await db.getAvertissementsForUser(guildId, userId);
  if (!list.length) {
    await interaction.update({ content: `<@${userId}> n'a aucun avertissement.`, components: [] });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`avert_select_suppr:${userId}`)
    .setPlaceholder('Avertissement à retirer')
    .addOptions(list.slice(0, 25).map((a, i) => ({
      label: `#${i + 1} — ${formatDate(a.date)}`,
      description: a.raison.slice(0, 100),
      value: String(a.id),
    })));
  await interaction.update({
    content: `Avertissements de <@${userId}> :`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleStringSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const guildId = interaction.guildId!;
  const userId = interaction.customId.split(':')[1];
  const id = Number(interaction.values[0]);

  const avant = await db.getAvertissementsForUser(guildId, userId);
  const numero = avant.findIndex(a => a.id === id) + 1;
  if (!numero || !(await db.deleteAvertissement(guildId, id))) {
    await interaction.update({ content: '❌ Cet avertissement a déjà été retiré.', components: [] });
    return;
  }
  const reste = avant.length - 1;
  await interaction.update({
    content: `✅ Avertissement #${numero} de <@${userId}> retiré — ${reste ? `il en reste ${reste}, renumérotés` : 'plus aucun avertissement'}.`,
    components: [],
  });
  await initPermanentMessage(interaction.client, guildId);
}

export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const guildId = interaction.guildId!;
  const selection = selections.get(interaction.customId.split(':')[1]);
  if (!selection) {
    await interaction.reply({ content: '❌ Sélection expirée — recommence avec le bouton « Ajouter un avertissement ».', flags: MessageFlags.Ephemeral });
    return;
  }

  const date = parseDate(interaction.fields.getTextInputValue('date'));
  if (date == null) {
    await interaction.reply({ content: '❌ Date invalide — format attendu : JJ/MM/AAAA (ex. 04/10/2026).', flags: MessageFlags.Ephemeral });
    return;
  }
  if (date > Date.now() + 24 * 60 * 60 * 1000) {
    await interaction.reply({ content: '❌ La date ne peut pas être dans le futur.', flags: MessageFlags.Ephemeral });
    return;
  }
  const raison = interaction.fields.getTextInputValue('raison').trim();
  if (!raison) {
    await interaction.reply({ content: '❌ La raison est obligatoire.', flags: MessageFlags.Ephemeral });
    return;
  }
  selections.delete(interaction.customId.split(':')[1]);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Revérifié à l'envoi : le rôle a pu être retiré pendant que le formulaire était ouvert.
  const members = await interaction.guild!.members.fetch({ user: selection.userIds });
  const lignes: string[] = selection.ignores.map(userId => `❌ <@${userId}> : pas le rôle membre, ignoré.`);
  const avertis: Array<{ userId: string; numero: number }> = [];
  for (const userId of selection.userIds) {
    const member = members.get(userId);
    if (!member || !estAvertissable(guildId, member)) {
      lignes.push(`❌ <@${userId}> : ne fait plus partie du groupe, ignoré.`);
      continue;
    }
    const numero = await db.addAvertissement(guildId, { userId, date, raison, auteurId: interaction.user.id });
    avertis.push({ userId, numero });
    lignes.push(`✅ <@${userId}> : ${ordinal(numero)} avertissement.`);
  }

  await interaction.editReply({ content: `Avertissement du ${formatDate(date)} :\n${lignes.join('\n')}`, allowedMentions: { parse: [] } });
  if (!avertis.length) return;
  await initPermanentMessage(interaction.client, guildId);
  await pingAvertis(interaction.client, guildId, avertis, date, raison);
}

// ─── PING DES PERSONNES AVERTIES (supprimé après 12h) ─────────────────────────

async function pingAvertis(client: Client, guildId: string, avertis: Array<{ userId: string; numero: number }>, date: number, raison: string): Promise<void> {
  const channelId = configStore.get(guildId).CHANNELS.avertissements;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  const deleteAt = Date.now() + PING_DURATION_MS;
  for (const { userId, numero } of avertis) {
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ ${ordinal(numero)} avertissement`)
      .setColor(0xE67E22)
      .setDescription(
        `Tu as reçu ton **${ordinal(numero)} avertissement**.\n\n` +
        `**Date :** ${formatDate(date)}\n**Raison :** ${raison}\n\n` +
        'Tous tes avertissements sont visibles dans le panneau de ce salon. ' +
        'Si tu perds le rôle membre, ils sont effacés.',
      )
      .setFooter({ text: 'Ce message sera supprimé automatiquement dans 12h' });
    try {
      const message = await channel.send({ content: `<@${userId}>`, embeds: [embed], allowedMentions: { users: [userId] } });
      await pingsQueue.run(guildId, async () => {
        const list = await getPendingPings(guildId);
        list.push({ channelId: channel.id, messageId: message.id, deleteAt });
        await db.setSetting(guildId, PINGS_KEY, JSON.stringify(list));
      });
    } catch (err) {
      console.error(`[avertissements] ping de ${userId} (${guildId}):`, (err as Error).message);
    }
  }
}

async function getPendingPings(guildId: string): Promise<PendingPing[]> {
  const raw = await db.getSetting(guildId, PINGS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as PendingPing[]; } catch { return []; }
}

/** Cron : supprime les messages de ping arrivés à échéance. Un message déjà effacé à la main compte comme supprimé ; une autre erreur le garde pour le passage suivant. */
export async function deleteExpiredPings(client: Client, guildId: string): Promise<void> {
  await pingsQueue.run(guildId, async () => {
    const list = await getPendingPings(guildId);
    if (!list.length) return;
    const now = Date.now();
    const restants: PendingPing[] = [];
    for (const ping of list) {
      if (ping.deleteAt > now) { restants.push(ping); continue; }
      try {
        const channel = await client.channels.fetch(ping.channelId).catch(() => null);
        if (channel?.isTextBased()) await channel.messages.delete(ping.messageId);
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code !== 10008 && code !== 10003) restants.push(ping); // message ou salon inconnu : rien à supprimer
      }
    }
    if (restants.length === list.length) return;
    if (restants.length) await db.setSetting(guildId, PINGS_KEY, JSON.stringify(restants));
    else await db.deleteSetting(guildId, PINGS_KEY);
  });
}

// ─── PURGE (plus membre du groupe) ────────────────────────────────────────────

async function purger(client: Client, guildId: string, userId: string, motif: string): Promise<void> {
  const count = await db.deleteAvertissementsForUser(guildId, userId);
  if (!count) return;
  console.log(`[avertissements] ${count} avertissement(s) de ${userId} purgé(s) (${guildId}) — ${motif}.`);
  await initPermanentMessage(client, guildId);
}

/** Rôle membre retiré → purge. Ne regarde que l'état final : l'ancien membre peut être partiel (pas en cache). */
export async function handleMemberUpdate(client: Client, member: GuildMember): Promise<void> {
  const guildId = member.guild.id;
  const roleId = configStore.get(guildId).MEMBER_ROLE_ID;
  if (!roleId || member.roles.cache.has(roleId)) return;
  await purger(client, guildId, member.id, 'rôle membre retiré');
}

export async function handleMemberLeave(client: Client, member: GuildMember | PartialGuildMember): Promise<void> {
  const guildId = member.guild.id;
  if (!configStore.get(guildId).MEMBER_ROLE_ID) return;
  await purger(client, guildId, member.id, 'a quitté le serveur');
}

/**
 * Au démarrage : purge les personnes qui ont perdu le rôle membre ou quitté
 * le serveur pendant que le bot était arrêté. Un échec de lecture des membres
 * ne purge rien — mieux vaut un avertissement en trop qu'un effacé à tort.
 */
export async function reconcile(client: Client, guildId: string): Promise<void> {
  const roleId = configStore.get(guildId).MEMBER_ROLE_ID;
  const guild = client.guilds.cache.get(guildId);
  if (!roleId || !guild) return;
  const ids = await db.getAvertisUserIds(guildId);
  if (!ids.length) return;
  const presents = await guild.members.fetch({ user: ids });
  for (const userId of ids) {
    const member = presents.get(userId);
    if (!member) await purger(client, guildId, userId, 'a quitté le serveur');
    else if (!member.roles.cache.has(roleId)) await purger(client, guildId, userId, 'rôle membre retiré');
  }
}
