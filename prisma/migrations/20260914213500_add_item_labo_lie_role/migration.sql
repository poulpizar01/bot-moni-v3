-- Précise le sens du lien labo_lie déjà existant : 'produit' (la drogue que
-- ce labo produit, seul usage jusqu'ici) ou 'materiau' (une matière première
-- qu'il consomme, nouveau). Backfill 'produit' pour tout labo_lie déjà posé,
-- seul rôle qui existait avant cette colonne.

ALTER TABLE "items" ADD COLUMN "labo_lie_role" TEXT;

UPDATE "items" SET "labo_lie_role" = 'produit' WHERE "labo_lie" IS NOT NULL;
