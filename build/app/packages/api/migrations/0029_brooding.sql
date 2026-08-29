-- Das Brut-Beet.
--
-- Dieselbe Mechanik wie beim Poké-Beet, nur am Ei: vier Pflegeschritte über
-- die Brutzeit, oder ein Pokémon, das sich automatisch darum kümmert. Die
-- Spalten stehen am Ei und nicht in einer eigenen Tabelle — es gibt genau eine
-- Pflege je Ei, und eine Nebentabelle für ein 1:1-Verhältnis wäre eine
-- Verbindung mehr bei jeder Abfrage.
ALTER TABLE eggs ADD COLUMN phases_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE eggs ADD COLUMN brooder_id TEXT REFERENCES creatures(id) ON DELETE SET NULL;
