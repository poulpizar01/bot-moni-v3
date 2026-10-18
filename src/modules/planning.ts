/**
 * @file src/modules/planning.ts
 * @description Panneau permanent du planning RP (salon `planning`) : les
 * admins y déclarent des objectifs datés par semaine (frontière dimanche 19h
 * Europe/Paris, comme les quotas/paie), par jour précis ou pour toute la
 * semaine — tout le monde consulte, seuls les admins ont les boutons actifs.
 *
 * La semaine affichée par le panneau n'est pas forcément la semaine courante
 * (navigation ◀/▶/Semaine actuelle) : ça permet de préparer le planning en
 * avance. Toute action Ajouter/Modifier/Supprimer porte sur la semaine
 * ACTUELLEMENT affichée, jamais sur une date saisie séparément.
 *
 * Le jour d'un objectif (0=lundi..6=dimanche, `null`=toute la semaine) est
 * toujours choisi via un menu déroulant, jamais en texte libre, pour éviter
 * toute faute de frappe/accent qui romprait silencieusement le tri. Un
 * objectif "toute la semaine" n'a jamais d'horaire par définition — le champ
 * n'apparaît même pas dans son modal.
 *
 * Éditer un créneau qui a déjà un ou plusieurs objectifs se fait par
 * SÉLECTION EXPLICITE (choisir lequel modifier, ou "nouvel horaire") plutôt
 * que par un matching silencieux sur le texte de l'horaire — l'admin voit
 * toujours les données existantes avant de les écraser.
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Client, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import * as db from '../db';
import * as configStore from '../config-store';
import { isAdmin } from '../permissions';
import { upsertPanel } from '../permanent-message';
import { buildChunkedEmbeds, type EmbedChunkSection } from '../embed-chunks';
import { parisWallClock, weekStartOf, nextWeekStartAfter } from '../paris-time';

const PANEL_TITLE = '📅 Planning';
const PANEL_SETTING_KEY = 'planning_message_id';
const WEEK_SETTING_KEY = 'planning_semaine_affichee';

const TITRE_MAX = 80;
const DESCRIPTION_MAX = 500;
const HORAIRE_MAX = 30;
const MAX_OPTIONS_SELECT = 25;

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

/**
 * En attente d'un modal après un ou deux selects : `id` présent = édition
 * d'un objectif existant (modal préremplie), absent = nouvel objectif.
 * Clé = `interaction.id` du select qui ouvre le modal (customId ≤ 100
 * caractères, trop peu pour porter ces informations directement).
 */
interface PlanningSelection { jour: number | null; id?: number; expiresAt: number }
const selections = new Map<string, PlanningSelection>();
const SELECTION_TTL_MS = 15 * 60 * 1000;

function cleanupSelections(): void {
  const now = Date.now();
  for (const [key, sel] of selections) if (sel.expiresAt < now) selections.delete(key);
}

function formatDateCourt(ms: number): string {
  const d = parisWallClock(new Date(ms));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getSemaineAffichee(guildId: string): Promise<number> {
  const raw = await db.getSetting(guildId, WEEK_SETTING_KEY);
  return raw ? Number(raw) : weekStartOf(Date.now());
}

function jourOptions(): Array<{ label: string; value: string; default?: boolean }> {
  return [{ label: 'Toute la semaine', value: 'semaine' }, ...JOURS.map((label, i) => ({ label, value: String(i) }))];
}

function parseJourValue(value: string): number | null {
  return value === 'semaine' ? null : Number(value);
}

function libelleObjectif(o: db.PlanningRow): string {
  const cible = o.jour === null ? 'Toute la semaine' : JOURS[o.jour];
  const horaireTxt = o.horaire ? ` [${o.horaire}]` : '';
  return `${cible}${horaireTxt} — ${o.titre}`;
}

function buildObjectifModal(customId: string, opts: { avecHoraire: boolean; existing?: db.PlanningRow; titre: string }): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(opts.titre.slice(0, 45));
  const rows: ActionRowBuilder<TextInputBuilder>[] = [];
  if (opts.avecHoraire) {
    const horaireInput = new TextInputBuilder().setCustomId('horaire').setLabel('Horaire (optionnel)')
      .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(HORAIRE_MAX);
    if (opts.existing?.horaire) horaireInput.setValue(opts.existing.horaire);
    rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(horaireInput));
  }
  const titreInput = new TextInputBuilder().setCustomId('titre').setLabel('Titre')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(TITRE_MAX);
  if (opts.existing?.titre) titreInput.setValue(opts.existing.titre);
  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(titreInput));
  const descInput = new TextInputBuilder().setCustomId('description').setLabel('Description (optionnel)')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(DESCRIPTION_MAX);
  if (opts.existing?.description) descInput.setValue(opts.existing.description);
  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(descInput));
  modal.addComponents(...rows);
  return modal;
}

// ─── PANNEAU ──────────────────────────────────────────────────────────────────

export async function initPermanentMessage(client: Client, guildId: string): Promise<void> {
  const channelId = configStore.get(guildId).CHANNELS.planning;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()) return;

    const semaine = await getSemaineAffichee(guildId);
    const objectifs = await db.getPlanningsForWeek(guildId, semaine);

    const parJour = new Map<number, db.PlanningRow[]>();
    const semaineEntiere: db.PlanningRow[] = [];
    for (const o of objectifs) {
      if (o.jour === null) { semaineEntiere.push(o); continue; }
      const list = parJour.get(o.jour) ?? [];
      list.push(o);
      parJour.set(o.jour, list);
    }

    const ligne = (o: db.PlanningRow) => {
      const horaireTxt = o.horaire ? `[${o.horaire}] ` : '';
      const desc = o.description ? ` — ${o.description.slice(0, 150)}` : '';
      return `• ${horaireTxt}${o.titre}${desc}`;
    };

    const sections: EmbedChunkSection[] = [];
    for (let jour = 0; jour < 7; jour++) {
      const list = parJour.get(jour);
      if (!list?.length) continue;
      sections.push({ header: `**${JOURS[jour]}**`, lines: list.map(ligne) });
    }
    if (semaineEntiere.length) sections.push({ header: '**Toute la semaine**', lines: semaineEntiere.map(ligne) });

    const debut = formatDateCourt(semaine + 24 * 60 * 60 * 1000);
    const fin = formatDateCourt(semaine + 7 * 24 * 60 * 60 * 1000);
    const intro = `**Semaine du ${debut} au ${fin}** — navigue entre les semaines et gère les objectifs avec les boutons ci-dessous.`;

    const embeds = buildChunkedEmbeds(sections, {
      title: PANEL_TITLE,
      color: 0x3498DB,
      emptyDescription: `${intro}\n\n*Aucun objectif pour cette semaine.*`,
    });
    if (sections.length) embeds[0].setDescription(`${intro}\n\n${embeds[0].data.description ?? ''}`);
    embeds[embeds.length - 1].setTimestamp();

    const rowCrud = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('planning_ajouter').setLabel('Ajouter un objectif').setStyle(ButtonStyle.Primary).setEmoji('➕'),
      new ButtonBuilder().setCustomId('planning_modifier').setLabel('Modifier un objectif').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
      new ButtonBuilder().setCustomId('planning_supprimer').setLabel('Supprimer un objectif').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    );
    const semaineCourante = weekStartOf(Date.now());
    const rowNav = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('planning_semaine_prec').setLabel('Semaine précédente').setStyle(ButtonStyle.Secondary).setEmoji('◀'),
      new ButtonBuilder().setCustomId('planning_semaine_actuelle').setLabel('Semaine actuelle').setStyle(ButtonStyle.Secondary).setDisabled(semaine === semaineCourante),
      new ButtonBuilder().setCustomId('planning_semaine_suiv').setLabel('Semaine suivante').setStyle(ButtonStyle.Secondary).setEmoji('▶'),
    );

    await upsertPanel(channel, guildId, PANEL_SETTING_KEY, PANEL_TITLE, async () => ({ embeds, components: [rowCrud, rowNav] }));
  } catch (err) {
    console.error(`[planning] initPermanentMessage(${guildId}):`, (err as Error).message);
  }
}

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────

async function refuserSiPasAdmin(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (isAdmin(interaction.guildId!, interaction.member)) return false;
  await interaction.reply({ content: '❌ Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
  return true;
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const guildId = interaction.guildId!;
  const cid = interaction.customId;

  if (cid === 'planning_semaine_prec' || cid === 'planning_semaine_suiv' || cid === 'planning_semaine_actuelle') {
    const actuelle = await getSemaineAffichee(guildId);
    const nouvelle = cid === 'planning_semaine_prec' ? weekStartOf(actuelle - 1)
      : cid === 'planning_semaine_suiv' ? nextWeekStartAfter(actuelle)
      : weekStartOf(Date.now());
    await db.setSetting(guildId, WEEK_SETTING_KEY, nouvelle);
    await interaction.deferUpdate();
    await initPermanentMessage(interaction.client, guildId);
    return;
  }

  if (cid === 'planning_ajouter') {
    const select = new StringSelectMenuBuilder().setCustomId('planning_select_jour_ajout')
      .setPlaceholder('Jour concerné').addOptions(jourOptions());
    await interaction.reply({
      content: 'Pour quel jour (ou toute la semaine) ?',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (cid === 'planning_modifier' || cid === 'planning_supprimer') {
    const semaine = await getSemaineAffichee(guildId);
    const objectifs = await db.getPlanningsForWeek(guildId, semaine);
    if (!objectifs.length) {
      await interaction.reply({ content: 'Aucun objectif cette semaine.', flags: MessageFlags.Ephemeral });
      return;
    }
    const action = cid === 'planning_modifier' ? 'modifier' : 'supprimer';
    const tronque = objectifs.length > MAX_OPTIONS_SELECT;
    const select = new StringSelectMenuBuilder()
      .setCustomId(`planning_select_${action}`)
      .setPlaceholder(`Objectif à ${action}`)
      .addOptions(objectifs.slice(0, MAX_OPTIONS_SELECT).map(o => ({ label: libelleObjectif(o).slice(0, 100), value: String(o.id) })));
    const avertissement = tronque ? `\n⚠️ ${objectifs.length - MAX_OPTIONS_SELECT} objectif(s) supplémentaire(s) non affiché(s).` : '';
    await interaction.reply({
      content: `Choisis un objectif à ${action} :${avertissement}`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Ouvre le modal d'ajout/édition pour `jour`, préremplie si `existant` est fourni. */
async function ouvrirModalAjout(interaction: StringSelectMenuInteraction, jour: number | null, existant: db.PlanningRow | undefined): Promise<void> {
  cleanupSelections();
  selections.set(interaction.id, { jour, id: existant?.id, expiresAt: Date.now() + SELECTION_TTL_MS });
  const modal = buildObjectifModal(`modal_planning_ajout:${interaction.id}`, {
    avecHoraire: jour !== null,
    existing: existant,
    titre: existant ? `Modifier — ${existant.titre}` : 'Nouvel objectif',
  });
  await interaction.showModal(modal);
}

export async function handleStringSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const guildId = interaction.guildId!;
  const cid = interaction.customId;

  if (cid === 'planning_select_jour_ajout') {
    const jour = parseJourValue(interaction.values[0]);
    const semaine = await getSemaineAffichee(guildId);
    const existants = await db.getPlanningsForWeek(guildId, semaine);

    if (jour === null) {
      await ouvrirModalAjout(interaction, jour, existants.find(o => o.jour === null));
      return;
    }

    const existantsJour = existants.filter(o => o.jour === jour);
    if (!existantsJour.length) {
      await ouvrirModalAjout(interaction, jour, undefined);
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`planning_select_horaire_ajout:${jour}`)
      .setPlaceholder('Créneau existant ou nouveau')
      .addOptions([
        ...existantsJour.slice(0, MAX_OPTIONS_SELECT - 1).map(o => ({
          label: (o.horaire?.trim() || 'Sans horaire').slice(0, 100),
          description: o.titre.slice(0, 100),
          value: String(o.id),
        })),
        { label: '➕ Nouvel horaire', value: 'nouveau' },
      ]);
    await interaction.update({
      content: `Des objectifs existent déjà ${JOURS[jour]} — choisis-en un pour le modifier, ou ajoute un nouvel horaire :`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    });
    return;
  }

  if (cid.startsWith('planning_select_horaire_ajout:')) {
    const jour = Number(cid.split(':')[1]);
    const value = interaction.values[0];
    const existant = value === 'nouveau' ? undefined : await db.getPlanningById(guildId, Number(value));
    await ouvrirModalAjout(interaction, jour, existant ?? undefined);
    return;
  }

  if (cid === 'planning_select_modifier') {
    const id = Number(interaction.values[0]);
    const objectif = await db.getPlanningById(guildId, id);
    if (!objectif) {
      await interaction.update({ content: '❌ Cet objectif a déjà été supprimé.', components: [] });
      return;
    }
    const valeurActuelle = objectif.jour === null ? 'semaine' : String(objectif.jour);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`planning_select_jour_modif:${id}`)
      .setPlaceholder('Jour concerné')
      .addOptions(jourOptions().map(o => ({ ...o, default: o.value === valeurActuelle })));
    await interaction.update({
      content: `Modification de « ${objectif.titre} » — jour :`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (cid.startsWith('planning_select_jour_modif:')) {
    const id = Number(cid.split(':')[1]);
    const objectif = await db.getPlanningById(guildId, id);
    if (!objectif) {
      await interaction.update({ content: '❌ Cet objectif a déjà été supprimé.', components: [] });
      return;
    }
    const jour = parseJourValue(interaction.values[0]);
    cleanupSelections();
    selections.set(interaction.id, { jour, id, expiresAt: Date.now() + SELECTION_TTL_MS });
    const modal = buildObjectifModal(`modal_planning_modif:${interaction.id}`, {
      avecHoraire: jour !== null,
      existing: objectif,
      titre: `Modifier — ${objectif.titre}`,
    });
    await interaction.showModal(modal);
    return;
  }

  if (cid === 'planning_select_supprimer') {
    const id = Number(interaction.values[0]);
    const ok = await db.deletePlanning(guildId, id);
    await interaction.update({ content: ok ? '✅ Objectif supprimé.' : '❌ Cet objectif a déjà été supprimé.', components: [] });
    if (ok) await initPermanentMessage(interaction.client, guildId);
  }
}

export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (await refuserSiPasAdmin(interaction)) return;
  const guildId = interaction.guildId!;
  const key = interaction.customId.split(':')[1];
  const selection = selections.get(key);
  if (!selection) {
    await interaction.reply({ content: '❌ Sélection expirée — recommence avec le bouton correspondant.', flags: MessageFlags.Ephemeral });
    return;
  }
  selections.delete(key);

  const titre = interaction.fields.getTextInputValue('titre').trim();
  if (!titre) {
    await interaction.reply({ content: '❌ Le titre est obligatoire.', flags: MessageFlags.Ephemeral });
    return;
  }
  const descriptionRaw = interaction.fields.getTextInputValue('description').trim();
  const description = descriptionRaw || null;
  const horaire = selection.jour !== null ? (interaction.fields.getTextInputValue('horaire').trim() || null) : null;

  if (selection.id != null) {
    const estModification = interaction.customId.startsWith('modal_planning_modif:');
    await db.updatePlanning(guildId, selection.id, {
      titre, description, horaire,
      ...(estModification ? { jour: selection.jour } : {}),
    });
    await interaction.reply({ content: `✅ Objectif mis à jour : **${titre}**`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  } else {
    const semaine = await getSemaineAffichee(guildId);
    await db.addPlanning(guildId, { weekStart: semaine, jour: selection.jour, horaire, titre, description, createdBy: interaction.user.id });
    await interaction.reply({ content: `✅ Objectif ajouté : **${titre}**`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  await initPermanentMessage(interaction.client, guildId);
}
