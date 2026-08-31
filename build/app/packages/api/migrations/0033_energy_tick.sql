-- Eigene Uhr für die Erholung, je Trainer.
--
-- Vorher hing sie an `last_seen_at`. Das ist derselbe Zeitstempel, den *jede*
-- Anfrage neu setzt: wer alle fünf Minuten in die App sah, verlor bei jedem
-- Blick die verstrichene Zeit und bekam nie etwas. Gemessen an einem echten
-- Spielstand: 40 von 100 eingelagerten Pokémon standen seit Tagen auf
-- demselben Wert.
--
-- Mit einer eigenen Uhr bleibt der Rest stehen: was für einen ganzen Punkt
-- nicht reicht, wird nicht verworfen, sondern beim nächsten Mal mitgezählt.
-- Team und Box brauchen getrennte Uhren, weil sie unterschiedlich schnell
-- laufen — eine gemeinsame würde der langsameren die Reste stehlen.
--
-- 0 heißt „noch nie getickt"; der Dienst setzt sie dann auf jetzt.
ALTER TABLE trainers ADD COLUMN box_energy_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trainers ADD COLUMN team_energy_at INTEGER NOT NULL DEFAULT 0;
