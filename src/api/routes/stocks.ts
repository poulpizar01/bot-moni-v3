/**
 * @file src/api/routes/stocks.ts
 * @description Lecture seule des stocks — résumé global, détail par coffre
 * (salon `logs_coffres`), et historique des mouvements. Le détail par coffre
 * (`CoffreStock`) est un complément du total global (`Stock`, toujours
 * exact) — les deux sont maintenus ensemble à chaque mouvement, voir
 * `stocks.parseAndApply`.
 *
 * Routes statiques `/history`/`/channels` déclarées AVANT `/:channelId` —
 * sinon Express interpréterait `/stocks/history` ou `/stocks/channels`
 * comme une recherche du coffre du même nom (même principe que
 * `/api/quotas`, `/:userId` toujours en dernier).
 *
 * `logs_coffres_admin` (coffres admin) est réservé aux admins : absent de
 * `/channels` pour un non-admin, `/:channelId` renvoie 403 si le salon
 * demandé en fait partie, et `/history` exclut leurs mouvements — mais `/`
 * (le total global) reste inchangé et inclut toujours leur contribution pour
 * tout le monde, sinon le total afficherait un stock faux.
 *
 * Chaque route filtre par `req.apiUser.guildId` (posé par `requireAuth`,
 * voir src/api/auth.ts) — jamais les données d'une autre guilde.
 */
import { Router } from 'express';
import * as db from '../../db';
import * as configStore from '../../config-store';

const router = Router();

/**
 * Complète une ligne de stock avec la configuration de son item (`/config
 * item`) : nom tel que configuré, groupe d'affichage, vendable aux PNJ,
 * visible dans le Stock Général, lien labo, multiplicateur. Sans ça, un
 * client ne peut pas distinguer une drogue d'un matériel ni regrouper comme
 * le panneau Discord. `null` partout si l'item n'est plus configuré (stock
 * orphelin) — la quantité, elle, reste vraie.
 */
function avecConfigItem<T extends { item: string }>(guildId: string, rows: T[]) {
  const items = configStore.get(guildId).ITEMS_BY_NAME;
  const parCle = new Map(Object.values(items).map(i => [i.name.toLowerCase(), i]));
  return rows.map(r => {
    const cfg = parCle.get(String(r.item).toLowerCase());
    return {
      ...r,
      name: cfg?.name ?? null,
      group: cfg?.stockGroup ?? null,
      vente: cfg?.vente ?? null,
      visibleStock: cfg?.visibleStock ?? null,
      laboLie: cfg?.laboLie ?? null,
      laboLieRole: cfg?.laboLieRole ?? null,
      stockMultiplier: cfg?.stockMultiplier ?? null,
    };
  });
}

/** GET /api/stocks — quantité actuelle de chaque item suivi, tous coffres confondus (inclut la contribution des coffres admin pour tout le monde — c'est le total réel, jamais amputé), avec la configuration de chaque item (voir `avecConfigItem`). */
router.get('/', async (req, res) => {
  const guildId = req.apiUser!.guildId;
  res.json(avecConfigItem(guildId, await db.getAllStocks(guildId)));
});

/**
 * GET /api/stocks/history?item=&channelId=&limit= — derniers mouvements,
 * filtrables par item (nom exact) et/ou par coffre. Même règle que
 * `/:channelId` pour les coffres admin : un non-admin ne voit pas leurs
 * mouvements (exclus de la liste, 403 s'il les demande explicitement) —
 * sinon l'historique global contournait la restriction du détail par coffre.
 */
router.get('/history', async (req, res) => {
  const apiUser = req.apiUser!;
  const item = typeof req.query.item === 'string' ? req.query.item : null;
  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : null;
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  const adminChannels = configStore.get(apiUser.guildId).CHANNELS.logs_coffres_admin;
  if (!apiUser.isAdmin && channelId && adminChannels.includes(channelId)) {
    res.status(403).json({ error: 'Accès réservé aux administrateurs pour ce coffre.' });
    return;
  }
  const excludeChannelIds = apiUser.isAdmin ? [] : adminChannels;
  res.json(await db.getRecentStockHistory(apiUser.guildId, item, limit, channelId, excludeChannelIds));
});

/** GET /api/stocks/channels — liste des salons de logs de coffre suivis (avec leur `label`). `logs_coffres_admin` n'est inclus que pour un admin. */
router.get('/channels', async (req, res) => {
  const apiUser = req.apiUser!;
  const normaux = (await db.getChannelsWithLabel(apiUser.guildId, 'logs_coffres')).map(c => ({ ...c, role: 'logs_coffres' as const }));
  const admin = apiUser.isAdmin
    ? (await db.getChannelsWithLabel(apiUser.guildId, 'logs_coffres_admin')).map(c => ({ ...c, role: 'logs_coffres_admin' as const }))
    : [];
  res.json([...normaux, ...admin]);
});

/**
 * GET /api/stocks/:channelId — quantité actuelle de chaque item pour UN
 * coffre précis (un salon `logs_coffres` ou `logs_coffres_admin` — voir
 * `/config channel list` côté Discord pour les identifiants). Liste vide
 * (pas d'erreur) si ce salon n'a encore aucun mouvement enregistré. Réservé
 * aux admins si ce salon précis est un coffre admin. Toujours en dernier :
 * route la plus générique du groupe.
 */
router.get('/:channelId', async (req, res) => {
  const apiUser = req.apiUser!;
  const channelId = req.params.channelId;
  if (!apiUser.isAdmin && configStore.get(apiUser.guildId).CHANNELS.logs_coffres_admin.includes(channelId)) {
    res.status(403).json({ error: 'Accès réservé aux administrateurs pour ce coffre.' });
    return;
  }
  res.json(avecConfigItem(apiUser.guildId, await db.getCoffreStocks(apiUser.guildId, channelId)));
});

export default router;
