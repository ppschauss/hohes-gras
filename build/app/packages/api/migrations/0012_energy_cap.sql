-- Kaufbarer Ausbau des Energievorrats. Zaehlt die gekauften Stufen, nicht die
-- Punkte: der Preis der naechsten Stufe haengt an ihrer Nummer.
ALTER TABLE trainers ADD COLUMN energy_cap_steps INTEGER NOT NULL DEFAULT 0;
