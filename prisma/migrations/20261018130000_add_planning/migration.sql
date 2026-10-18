-- Objectifs de planning RP, datés par semaine (frontière dimanche 19h
-- Europe/Paris) et optionnellement par jour (0=lundi..6=dimanche) ;
-- null = objectif valable toute la semaine.
CREATE TABLE "planning" (
    "guild_id" TEXT NOT NULL,
    "id" SERIAL NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "jour" INTEGER,
    "horaire" TEXT,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "planning_guild_id_week_start_idx" ON "planning"("guild_id", "week_start");
