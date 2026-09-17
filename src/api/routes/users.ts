/**
 * @file src/api/routes/users.ts
 * @description Lecture seule des comptes Discord connus de la guilde —
 * partagé entre plusieurs groupes de routes (quotas, ventes) au lieu d'une
 * liste dupliquée sous chacun. Un non-admin ne reçoit que lui-même (même
 * logique que `requireSelfOrAdmin` sur les routes `:userId` — il n'a pas
 * besoin de connaître les autres comptes de la guilde).
 */
import { Router } from 'express';
import * as db from '../../db';

const router = Router();

/** GET /api/users — comptes Discord connus de la guilde (userId + dernier nom connu). Un non-admin ne reçoit que lui-même. */
router.get('/', async (req, res) => {
  const apiUser = req.apiUser!;
  if (!apiUser.isAdmin) {
    res.json([{ userId: apiUser.id, username: apiUser.username }]);
    return;
  }
  res.json(await db.getKnownUsers(apiUser.guildId));
});

export default router;
