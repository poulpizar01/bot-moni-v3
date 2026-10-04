-- Reprise des évolutions de roxwood-network-famille : ajouts uniquement, aucune
-- colonne ni ligne supprimée (stats.points, pending_sales.prix_pochon,
-- guilds.added_at et les rôles 'taxes' restent en place).

-- Retrait net réel constaté dans les logs de coffre, qui borne la quantité
-- déclarée vendue. Pour les ventes déjà existantes, la meilleure valeur connue
-- est la quantité enregistrée.
ALTER TABLE "pending_sales" ADD COLUMN "quantite_retiree" INTEGER;
UPDATE "pending_sales" SET "quantite_retiree" = "quantite";
ALTER TABLE "pending_sales" ALTER COLUMN "quantite_retiree" SET NOT NULL;

CREATE INDEX "pending_sales_guild_id_joueur_item_idx" ON "pending_sales"("guild_id", "joueur", "item");

CREATE INDEX "taxes_guild_id_type_idx" ON "taxes"("guild_id", "type");
