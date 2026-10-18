-- Top 3 hebdomadaire par catégorie ("actions"/"vente"/"labos"/"recolte"/"munitions")
-- et par portée ("individuel"/"groupe") — un seul emplacement par (guild, catégorie,
-- portée, rang), remplacé en place quand un meilleur total est atteint.
CREATE TABLE "weekly_records" (
    "guild_id" TEXT NOT NULL,
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "user_id" TEXT,
    "total" DOUBLE PRECISION NOT NULL,
    "week_until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weekly_records_guild_id_category_scope_rank_key" ON "weekly_records"("guild_id", "category", "scope", "rank");
CREATE INDEX "weekly_records_guild_id_category_idx" ON "weekly_records"("guild_id", "category");
