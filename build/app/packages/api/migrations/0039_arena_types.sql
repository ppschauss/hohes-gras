-- Der Tagesabschluss zählt je Stufe **und** Typ.
--
-- Seit es drei Typen am Tag gibt, wäre „einmal je Stufe" zu wenig: wer Feuer
-- auf „schwer" geschafft hat, soll Wasser auf „schwer" noch voll bezahlt
-- bekommen. Sonst wären die drei Angebote in Wahrheit eines.
--
-- SQLite kann keinen Primärschlüssel ändern, also neu anlegen und umfüllen.
-- Die bisherigen Abschlüsse bekommen den Typ des jeweiligen Tages nicht mehr
-- rückwirkend zugeordnet — sie zählen als „erster Typ", was höchstens dazu
-- führt, dass jemand heute einen Durchlauf mehr voll bezahlt bekommt.
CREATE TABLE arena_clears_neu (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  game_date  TEXT NOT NULL,
  tier       TEXT NOT NULL,
  type_id    TEXT NOT NULL DEFAULT '',
  cleared_at INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, game_date, tier, type_id)
) STRICT;

INSERT INTO arena_clears_neu (trainer_id, game_date, tier, type_id, cleared_at)
SELECT trainer_id, game_date, tier, '', cleared_at FROM arena_clears;

DROP TABLE arena_clears;
ALTER TABLE arena_clears_neu RENAME TO arena_clears;
