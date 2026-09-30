/**
 * @file src/api/routes/garages.ts
 * @description Lecture seule des garages — véhicules actuellement sortis et
 * classement des fourrières, mêmes données que `modules/garages.ts` (état par
 * plaque déduit des logs `logs_garages`, voir sa docstring).
 *
 *  • GET /api/garages/vehicles — véhicules sortis et pas encore rangés, avec
 *    leur responsable courant (celui qui serait imputé d'une fourrière).
 *  • GET /api/garages/impounds — classement des fourrières, réservé aux
 *    admins (même règle que la commande Discord `/fourrieres`). Le montant
 *    est purement indicatif, aucune facturation automatique nulle part.
 *
 * Chaque route filtre par `req.apiUser.guildId` (posé par `requireAuth`).
 */
import { Router } from 'express';
import * as db from '../../db';
import { MONTANT_FOURRIERE } from '../../modules/garages';

const router = Router();

/** GET /api/garages/vehicles — véhicules sortis (responsable connu), du plus récent au plus ancien. */
router.get('/vehicles', async (req, res) => {
  res.json(await db.getVehiculesSortis(req.apiUser!.guildId));
});

/** GET /api/garages/impounds — classement cumulé des fourrières par joueur (décroissant) + montant indicatif par fourrière. Admin uniquement. */
router.get('/impounds', async (req, res) => {
  const apiUser = req.apiUser!;
  if (!apiUser.isAdmin) {
    res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    return;
  }
  res.json({ montantIndicatif: MONTANT_FOURRIERE, classement: await db.getFourriereClassement(apiUser.guildId) });
});

export default router;
