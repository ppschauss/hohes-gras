-- Sagenbeeren, die in der laufenden Begegnung schon eingesetzt wurden.
--
-- Am Encounter statt am Trainer: sie gelten fuer genau diese Begegnung und
-- verfallen mit ihr. Waeren sie am Trainer, blieben sie ueber ein Weglaufen
-- hinweg stehen.
ALTER TABLE active_encounter ADD COLUMN legendary_berries INTEGER NOT NULL DEFAULT 0;
