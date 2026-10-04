-- CreateTable
CREATE TABLE "avertissements" (
    "guild_id" TEXT NOT NULL,
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "raison" TEXT NOT NULL,
    "auteur_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avertissements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avertissements_guild_id_user_id_idx" ON "avertissements"("guild_id", "user_id");
