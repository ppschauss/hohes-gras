-- Auf welchem Niveau ein Trainer eine Region zum ersten Mal betreten hat.
--
-- Der Regionsversatz muss an diesen Moment gebunden sein, nicht an das heutige
-- Teamlevel. Rechnet man ihn jedes Mal neu, wächst er mit dem Spieler mit: wer
-- in Johto mit Level 5 anfängt, findet den Silberberg auf 38 vor — und auf 50,
-- sobald er selbst 20 ist. Die eigene Liga liefe einem davon.
--
-- Der erste Eintrag gewinnt; spätere Besuche ändern nichts.
CREATE TABLE IF NOT EXISTS region_entries (
  trainer_id      TEXT    NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  region_id       TEXT    NOT NULL,
  reference_level INTEGER NOT NULL,
  entered_at      INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, region_id)
) STRICT;
