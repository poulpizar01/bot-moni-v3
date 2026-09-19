/**
 * @file src/api/routes/users.ts
 * @description Lecture seule des comptes Discord connus de la guilde —
 * partagé entre plusieurs groupes de routes (quotas, ventes) au lieu d'une
 * liste dupliquée sous chacun. Un non-admin ne reçoit que lui-même (même
 * logique que `requireSelfOrAdmin` sur les routes `:userId`).
 */
import { Router } from 'express';
import * as db from '../../db';

const router = Router();

/** GET /api/users — comptes Discord connus de la guilde (userId, dernier pseudo, nom en jeu). Un non-admin ne reçoit que lui-même ; les noms des autres joueurs, il les trouve déjà sur les lignes des routes de groupe (voir `../noms.ts`). */
router.get('/', async (req, res) => {
  const apiUser = req.apiUser!;
  const known = await db.getKnownUsers(apiUser.guildId);
  if (!apiUser.isAdmin) {
    const self = known.find(u => u.userId === apiUser.id);
    res.json([{ userId: apiUser.id, username: apiUser.username, gameName: self?.gameName ?? null }]);
    return;
  }
  res.json(known);
});

export default router;
