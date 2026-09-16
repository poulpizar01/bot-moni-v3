-- CreateTable
CREATE TABLE "item_salary_rates" (
    "guild_id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "item_salary_rates_pkey" PRIMARY KEY ("guild_id","item")
);
