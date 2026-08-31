-- Was ein Lauf bisher eingebracht hat.
--
-- Damit am Ende eine Abrechnung stehen kann: „das hast du geholt". Ohne sie
-- verschwindet die Beute eines Laufs stumm im Beutel, und eine Serie von
-- dreißig fühlt sich an wie nichts — dieselbe Lücke wie bei den Kämpfen und
-- Raids, nur über eine ganze Sitzung hinweg.
ALTER TABLE gauntlet_runs ADD COLUMN total_gold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gauntlet_runs ADD COLUMN total_xp   INTEGER NOT NULL DEFAULT 0;
-- Gegenstand-Id auf Menge, als JSON. Eine eigene Tabelle wäre sauberer, aber
-- der Inhalt lebt genau so lange wie die Zeile darüber.
ALTER TABLE gauntlet_runs ADD COLUMN loot TEXT NOT NULL DEFAULT '{}';
