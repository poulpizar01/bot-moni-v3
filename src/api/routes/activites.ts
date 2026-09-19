/**
 * @file src/api/routes/activites.ts
 * @description Lecture seule de l'état « du moment » des activités : plafonds
 * de braquage de la semaine glissante et cooldowns personnels. Ce sont
 * exactement les informations que le bot affiche déjà à tout membre sur
 * Discord (panneau quotas : dispo braquages ; alertes : fin de cooldown) —
 * rien de plus.
 *
 * Deux sous-ressources dans un même fichier, montées séparément dans
 * server.ts (`/api/braquages`, `/api/cooldowns`) pour garder des URL plates,
 * cohérentes avec le reste de l'API.
 *
 *  • GET /api/braquages — pour chaque activité plafonnée (`braquageWeeklyLimit`
 *    non nul, tier courant), le plafond, le nombre déjà consommé dans la
 *    fenêtre glissante de 7 jours (même calcul que `checkBraquageLimit`), le
 *    reste, et la date à laquelle un créneau se libérera si tout est pris.
 *  • GET /api/cooldowns — les cooldowns actifs du requérant ; `/:userId`
 *    pour un autre joueur, réservé à soi-même ou à un admin.
 *
 * Chaque route filtre par `req.apiUser.guildId` (posé par `requireAuth`).
 */
import { Router } from 'express';
import * as db from '../../db';
import * as configStore from '../../config-store';
import { activityDisplayLabel } from '../../config-store';
import { requireSelfOrAdmin } from '../auth';

const { SEVEN_DAYS_MS } = db;

export const braquagesRouter = Router();
export const cooldownsRouter = Router();

/** GET /api/braquages — plafonds et consommation de la semaine glissante, activités plafonnées du tier courant uniquement. */
braquagesRouter.get('/', async (req, res) => {
  const guildId = req.apiUser!.guildId;
  const types = configStore.get(guildId).ACTIVITY_TYPES;
  const plafonnees = Object.entries(types).filter(([, cfg]) => cfg.enabled && cfg.braquageWeeklyLimit != null);
  const rows = await Promise.all(plafonnees.map(async ([action, cfg]) => {
    const limit = cfg.braquageWeeklyLimit!;
    const used = await db.getBraquageCount(guildId, action);
    const oldest = used >= limit ? await db.getOldestBraquage(guildId, action) : null;
    return {
      action,
      label: activityDisplayLabel(cfg),
      limit,
      used,
      available: Math.max(0, limit - used),
      /** Instant où le plus ancien braquage sort de la fenêtre — `null` tant qu'il reste un créneau. */
      nextFreeAt: oldest != null ? oldest + SEVEN_DAYS_MS : null,
    };
  }));
  res.json({ windowMs: SEVEN_DAYS_MS, braquages: rows });
});

/** Cooldowns actifs d'UN joueur, avec le libellé de l'activité. */
async function cooldownsDe(guildId: string, userId: string) {
  const types = configStore.get(guildId).ACTIVITY_TYPES;
  return (await db.getActiveCooldowns(guildId))
    .filter(c => c.userId === userId)
    .map(c => ({ action: c.action, label: types[c.action] ? activityDisplayLabel(types[c.action]) : c.action, expiresAt: c.expires_at }))
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

/** GET /api/cooldowns — les cooldowns actifs du requérant. */
cooldownsRouter.get('/', async (req, res) => {
  const { guildId, id } = req.apiUser!;
  res.json({ userId: id, cooldowns: await cooldownsDe(guildId, id) });
});

/** GET /api/cooldowns/:userId — ceux d'un joueur précis. Réservé à soi-même ou un admin (voir `requireSelfOrAdmin`). */
cooldownsRouter.get('/:userId', requireSelfOrAdmin, async (req, res) => {
  const userId = String(req.params.userId);
  res.json({ userId, cooldowns: await cooldownsDe(req.apiUser!.guildId, userId) });
});
