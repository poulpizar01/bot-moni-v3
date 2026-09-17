/**
 * @file src/default-items.ts
 * @description Pré-remplissage d'items connus, s'ils sont absents — évite
 * d'avoir à les taper à la main via `/config item add` pour un déploiement
 * neuf. Appelé à deux endroits (voir `seedDefaultItems`), pas seulement au
 * démarrage global du process : `index.ts` (une fois par démarrage — utile
 * dès le tout premier rendu des panneaux) ET `modules/config.ts` (à chaque
 * usage de `/config` — pour qu'un bot déjà en cours d'exécution depuis un
 * moment se retrouve avec ces items sans attendre un redémarrage). Les deux
 * appels sont sans risque : no-op dès que tout est déjà présent.
 *
 * Ce n'est PAS un registre fixe comme `ACTIVITY_TYPES_FIXED`
 * (config-store.ts) : un item pré-rempli reste ensuite un item de config
 * comme un autre, modifiable ou supprimable via `/config item` — cette liste
 * ne fait qu'insérer une valeur de départ, une seule fois, jamais écraser un
 * item déjà présent (vérifié par nom exact avant toute insertion).
 *
 * **Piège n°1 du projet (voir CLAUDE.md)** : chaque `name` ci-dessous doit
 * être l'orthographe EXACTE (accents, casse) telle qu'écrite par le bot de
 * jeu FiveM dans les logs de coffre — vérifiée par l'admin, jamais devinée.
 * Ne pas ajouter d'entrée ici sans cette confirmation explicite.
 */
import * as db from './db';
import * as configStore from './config-store';
import { MUNITIONS_STOCK_GROUP, MUNITIONS_SMG_ITEM } from './modules/armurerie';
import { CONFIRME_VENTE_ITEM } from './modules/ventes';

// `display_order` négatif : garantit que les 5 items par défaut restent
// TOUJOURS en tête du Stock Général, quel que soit l'ordre d'insertion réel
// ou de futurs items ajoutés via `/config item add` (qui n'expose pas cette
// option et retombe donc sur le défaut 0, donc toujours après). Valeurs
// posées ici explicitement plutôt que déduites de l'ordre du tableau —
// db.upsertItem ne touche jamais cette valeur pour un item déjà existant si
// `display_order` n'est pas fourni (voir docstring de `upsertItem`), donc un
// futur /config item add sur l'un de ces 5 items ne peut pas la réinitialiser.
const DEFAULT_ITEMS: db.ItemInput[] = [
  // CONFIRME_VENTE_ITEM (voir ventes.ts) — simple item de stock ici, son rôle
  // de confirmation de vente est fixe dans le code, pas un flag à poser.
  { name: CONFIRME_VENTE_ITEM, display_order: -5 },
  // Distinct de CONFIRME_VENTE_ITEM ("Argent Sale") : simple item de stock,
  // ne joue aucun rôle dans le cycle de vente.
  { name: 'Argent', display_order: -4 },
  { name: 'Munition de pistolet', stock_group: MUNITIONS_STOCK_GROUP, display_order: -3 },
  // Vaut 24x "Munition de pistolet" (stock_multiplier) — même groupe, comptée
  // en conséquence dans le total munitions pondéré (voir armurerie.weightedStockSum).
  { name: 'Boîte mun. pistolet', stock_group: MUNITIONS_STOCK_GROUP, stock_multiplier: 24, display_order: -2 },
  // Simple item de stock, sans groupe : affiché dans l'armurerie via
  // MUNITIONS_SMG_ITEM (stock brut uniquement, pas de quota fabrication/vente).
  { name: MUNITIONS_SMG_ITEM, display_order: -1 },
];

/**
 * Insère chaque item de {@link DEFAULT_ITEMS} qui n'existe pas encore dans la
 * config actuelle (comparaison par nom exact) — ne touche jamais à un item
 * déjà configuré, même si ses options diffèrent de la valeur par défaut ici.
 * Idempotent — safe à appeler à répétition (voir docstring de fichier).
 */
export async function seedDefaultItems(guildId: string): Promise<void> {
  const existing = configStore.get(guildId).ITEMS_BY_NAME;
  let inserted = false;

  for (const item of DEFAULT_ITEMS) {
    if (existing[item.name]) continue;
    await db.upsertItem(guildId, item);
    inserted = true;
    console.log(`[default-items] Item pré-rempli (${guildId}) : ${item.name}`);
  }

  if (inserted) await configStore.reload(guildId);
}
