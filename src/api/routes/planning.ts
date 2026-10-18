/**
 * @file src/api/routes/planning.ts
 * @description Lecture seule des objectifs de planning RP — même accès que
 * le reste de l'API (`requireAuth`, pas de rôle dédié, comme `/api/records`).
 * `?week=` fonctionne aussi pour une semaine FUTURE (contrairement aux autres
 * endpoints de ce module, où ça ne sert qu'à l'historique) : les HG
 * préparent le planning en avance via la navigation du panneau Discord.
 */
import { Router } from 'express';
import * as db from '../../db';
import { resolveWeekRange } from '../week';

const router = Router();

/** GET /api/planning?week= — objectifs de la semaine demandée (courante par défaut), triés par jour puis id. */
router.get('/', async (req, res) => {
  const guildId = req.apiUser!.guildId;
  const range = await resolveWeekRange(req, res, guildId);
  if (!range) return;
  const rows = await db.getPlanningsForWeek(guildId, range.since);
  res.json({ range, objectifs: rows.map(r => ({ id: r.id, jour: r.jour, horaire: r.horaire, titre: r.titre, description: r.description })) });
});

export default router;
