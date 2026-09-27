-- Le total global est desormais la somme de coffre_stocks, calculee a la
-- lecture : un compteur separe divergeait (plancher a 0 applique
-- independamment au global et a chaque coffre).
DROP TABLE "stocks";

-- Sommes par item (total global) sans parcourir tous les coffres.
CREATE INDEX "coffre_stocks_guild_id_item_idx" ON "coffre_stocks"("guild_id", "item");
