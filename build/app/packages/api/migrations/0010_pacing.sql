-- Taktkontrolle: Zeitpunkte der letzten Aktionen je Trainer und Eimer.
--
-- Bewusst eine eigene Tabelle statt einer Auswertung des Ereignisprotokolls:
-- das Protokoll ist eine Historie, die lange stehen bleibt, hier geht es um
-- die letzten Minuten. Getrennte Lebensdauern, getrennte Tabellen.
CREATE TABLE action_pulse (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  bucket     TEXT NOT NULL,
  at         INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_action_pulse_lookup ON action_pulse(trainer_id, bucket, at);
