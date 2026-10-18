/**
 * @file src/api/routes/records.ts
 * @description Lecture seule des records hebdomadaires (top 3 par catégorie
 * et par portée) — même accès que le reste de l'API (`requireAuth`, pas de
 * rôle dédié). Les emplacements sont calculés une fois par semaine close,
 * voir `quotas.checkAndUpdateRecords` (branché sur le reset hebdomadaire,
 * jamais recalculé à la lecture).
 */
import { Router } from 'express';
import * as db from '../../db';
import { RECORD_CATEGORIES } from '../../modules/quotas';
import { avecNoms } from '../noms';

const router = Router();

/**
 * GET /api/records — podium actuel de chaque catégorie (`actions`, `vente`,
 * `labos`, `recolte`), en portée `individuel` (top 3 joueurs,
 * avec `name`) et `groupe` (meilleure semaine de la guilde entière, `userId`
 * et `name` toujours `null`). Une catégorie/portée sans record encore établi
 * renvoie un tableau vide plutôt qu'une absence de clé.
 */
router.get('/', async (req, res) => {
  const guildId = req.apiUser!.guildId;
  const rows = await avecNoms(guildId, await db.getAllWeeklyRecords(guildId));

  const result: Record<string, { individuel: typeof rows; groupe: typeof rows }> = {};
  for (const category of RECORD_CATEGORIES) result[category] = { individuel: [], groupe: [] };
  for (const row of rows) {
    const bucket = result[row.category];
    if (bucket && (row.scope === 'individuel' || row.scope === 'groupe')) bucket[row.scope].push(row);
  }

  res.json(result);
});

export default router;
