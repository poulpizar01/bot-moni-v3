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
 * item déjà présent (vérifié par nom, sans tenir compte de la casse, avant toute insertion).
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

// `display_order` négatif : garantit que les 5 items génériques ci-dessous restent
// TOUJOURS en tête du Stock Général, quel que soit l'ordre d'insertion réel
// ou de futurs items ajoutés via `/config item add` (qui n'expose pas cette
// option et retombe donc sur le défaut 0, donc toujours après). Valeurs
// posées ici explicitement plutôt que déduites de l'ordre du tableau —
// db.upsertItem ne touche jamais cette valeur pour un item déjà existant si
// `display_order` n'est pas fourni (voir docstring de `upsertItem`), donc un
// futur /config item add sur l'un de ces 5 items ne peut pas la réinitialiser.
// Repris de roxwood-network-famille, branche `release/1.1` (celle qui ajoute
// Vénia comme labo générique, pas seulement notre instance) — chaque nom est
// RÉELLEMENT présent dans nos propres logs de coffre (script `_check-items.ts`,
// lecture seule, exécuté le 18/10/2026 sur les salons configurés) ou déjà
// configuré en base sur cette instance depuis un ajout manuel antérieur
// (`/config item add`) ; « Vénia Purifier À 99 » est confirmé par le scan,
// les trois autres paliers (50/70/90) suivent la même convention de nommage
// que toutes les autres drogues purifiées ci-dessous, jamais vérifiés un par
// un séparément. Deux noms de la liste roxwood sont volontairement ABSENTS,
// confirmés faux pour nous : « Or Rouge » (jamais vu dans nos coffres) et
// « Outil de crochetage » (nos logs écrivent « Outil de crochettage », deux "t").
const DEFAULT_ITEMS: db.ItemInput[] = [
  // L'argent précède les munitions dans le Stock Général.
  { name: 'Argent', display_order: -5 },
  // CONFIRME_VENTE_ITEM joue aussi le rôle fixe de confirmation des ventes.
  { name: CONFIRME_VENTE_ITEM, display_order: -4 },
  { name: 'Munition de pistolet', stock_group: MUNITIONS_STOCK_GROUP, display_order: -3 },
  // Vaut 24x "Munition de pistolet" (stock_multiplier) — même groupe, comptée
  // en conséquence dans le total munitions pondéré (voir armurerie.weightedStockSum).
  { name: 'Boîte mun. pistolet', stock_group: MUNITIONS_STOCK_GROUP, stock_multiplier: 24, display_order: -2 },
  // Simple item de stock, sans groupe : affiché dans l'armurerie via
  // MUNITIONS_SMG_ITEM (stock brut uniquement, pas de quota fabrication/vente).
  { name: MUNITIONS_SMG_ITEM, display_order: -1 },
  // Butin/outils de casse — simple suivi de stock, pas de vente:true.
  { name: 'Or Bleu' },
  { name: 'Jetons ETI' },
  { name: 'Outil de crochettage' },
  { name: 'Boîtier de piratage' },
  { name: 'Perceuse' },
  { name: 'Carte Piratage Fleeca' },
  // Drogues vendables aux PNJ sans lien avec un labo particulier (variantes de
  // pureté/formes commerciales). "Cocaine Pure", "Héroine Pure" et "Vénia
  // Purifier" s'écrivent bien sans tréma dans les logs, contrairement aux
  // items "Cocaïne"/"Héroïne"/"Vénia" des labos plus bas.
  { name: 'Mexicana Pure À 99', vente: true },
  { name: 'Mexicana Pure À 90', vente: true },
  { name: 'Mexicana Pure À 70', vente: true },
  { name: 'Mexicana Pure À 50', vente: true },
  { name: 'Cocaine Pure À 99', vente: true },
  { name: 'Cocaine Pure À 90', vente: true },
  { name: 'Cocaine Pure À 70', vente: true },
  { name: 'Cocaine Pure À 50', vente: true },
  { name: 'Weed Pure À 99', vente: true },
  { name: 'Weed Pure À 90', vente: true },
  { name: 'Weed Pure À 70', vente: true },
  { name: 'Weed Pure À 50', vente: true },
  { name: 'Héroine Pure À 99', vente: true },
  { name: 'Héroine Pure À 90', vente: true },
  { name: 'Héroine Pure À 70', vente: true },
  { name: 'Héroine Pure À 50', vente: true },
  { name: 'Vénia Purifier À 99', vente: true },
  { name: 'Vénia Purifier À 90', vente: true },
  { name: 'Vénia Purifier À 70', vente: true },
  { name: 'Vénia Purifier À 50', vente: true },
  { name: 'Carte Prépayée', vente: true },
  { name: 'B-magic', vente: true },
  { name: 'Ecstasy', vente: true },
  { name: 'Tranq', vente: true },
  { name: 'Meth bleue', vente: true },
  { name: 'Lean', vente: true },
  { name: 'H-47', vente: true },
  // Labo Branche De Cannabis (Indépendant) — déjà en base, mais sans
  // mouvement récent dans le scan (tier actuel probablement pas Indépendant) :
  // confiance reportée sur la vérification antérieure de l'utilisateur, pas
  // sur ce scan-ci.
  { name: 'Branche de cannabis', labo_lie: 'labo_branche_cannabis', labo_lie_role: 'produit' },
  { name: 'Graine de strawberry', labo_lie: 'labo_branche_cannabis', labo_lie_role: 'materiau' },
  { name: 'Pot de plantation', labo_lie: 'labo_branche_cannabis', labo_lie_role: 'materiau' },
  { name: 'Fertilisant', labo_lie: 'labo_branche_cannabis', labo_lie_role: 'materiau' },
  // Labo Spore X (Petite Frappe) — produit + matériaux. vente:true (comme
  // Cannabis/Cocaïne/Mexicana plus bas, release/1.1 de roxwood) : reste
  // vendable au PNJ pour un tier qui n'a pas ce labo actif.
  { name: 'Pochon De SporeX', vente: true, labo_lie: 'labo_sporex', labo_lie_role: 'produit' },
  { name: 'Psilocybe Rouge', labo_lie: 'labo_sporex', labo_lie_role: 'materiau' },
  { name: 'Psilocybe Vert', labo_lie: 'labo_sporex', labo_lie_role: 'materiau' },
  { name: 'Psilocybe Violet', labo_lie: 'labo_sporex', labo_lie_role: 'materiau' },
  { name: 'Poudre à canon', labo_lie: 'labo_sporex', labo_lie_role: 'materiau' },
  { name: 'Fragment de métal', labo_lie: 'labo_sporex', labo_lie_role: 'materiau' },
  // Labo Héroïne (Petite Frappe) — produit (avec tréma, distinct des 4 variantes
  // « Héroine Pure À X » plus haut, sans tréma) + matériaux. Même remarque
  // vente:true que Spore X ci-dessus.
  { name: 'Héroïne', vente: true, labo_lie: 'labo_heroine', labo_lie_role: 'produit' },
  { name: 'Datura', labo_lie: 'labo_heroine', labo_lie_role: 'materiau' },
  { name: 'Morphine', labo_lie: 'labo_heroine', labo_lie_role: 'materiau' },
  // Labo Vénia (Petite Frappe) — produit (avec tréma, distinct des 4 variantes
  // « Vénia Purifier À X » plus haut, sans tréma) + matériaux. Même remarque
  // vente:true que Spore X ci-dessus.
  { name: 'Vénia', vente: true, labo_lie: 'labo_venia', labo_lie_role: 'produit' },
  { name: 'Fleur Séchée', labo_lie: 'labo_venia', labo_lie_role: 'materiau' },
  { name: 'Cendre Noir', labo_lie: 'labo_venia', labo_lie_role: 'materiau' },
  // Labo Cannabis (Gang) — produit seul. vente:true : reste vendable au PNJ
  // pour un tier qui n'a pas ce labo actif (voir config-store.ts, laboLieRole).
  { name: 'Cannabis', vente: true, labo_lie: 'labo_cannabis', labo_lie_role: 'produit' },
  // Labo Cocaïne (Organisation) — produit seul, même remarque que Cannabis.
  { name: 'Cocaïne', vente: true, labo_lie: 'labo_cocaine', labo_lie_role: 'produit' },
  // Labo Mexicana (Gang · Organisation) — produit seul, même remarque.
  { name: 'Pochon De Mexicana', vente: true, labo_lie: 'labo_mexicana', labo_lie_role: 'produit' },
];

/**
 * Insère chaque item de {@link DEFAULT_ITEMS} qui n'existe pas encore dans la
 * config actuelle (comparaison insensible à la casse) — ne touche jamais à
 * un item déjà configuré, même si ses options diffèrent de la valeur par
 * défaut ici. Idempotent — safe à appeler à répétition (voir docstring de
 * fichier).
 * @returns `true` si au moins un item a été inséré (le Stock Général est alors à rafraîchir).
 */
export async function seedDefaultItems(guildId: string): Promise<boolean> {
  // Comparaison insensible à la casse : un admin qui a saisi "argent sale"
  // ne doit pas se retrouver avec un doublon "Argent Sale" — le stock étant
  // indexé en minuscules, les deux lignes afficheraient la même quantité.
  const existing = new Set(Object.keys(configStore.get(guildId).ITEMS_BY_NAME).map(name => name.toLowerCase()));
  const manquants = DEFAULT_ITEMS.filter(item => !existing.has(item.name.toLowerCase()));
  if (!manquants.length) return false;

  // Via `mutate` : le cache est rechargé même si une insertion échoue en route.
  await configStore.mutate(guildId, async () => {
    for (const item of manquants) {
      await db.upsertItem(guildId, item);
      console.log(`[default-items] Item pré-rempli (${guildId}) : ${item.name}`);
    }
  });
  return true;
}
