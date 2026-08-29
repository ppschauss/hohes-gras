-- Trainingsarena: vier Kämpfe in Folge gegen einen Typ des Tages.

-- Der Gegner eines Arenakampfes steht in keinem Content-Pack — er wird aus dem
-- Typ des Tages und dem eigenen Durchschnittslevel erzeugt. Damit der Kampf
-- ihn nach dem Neuladen noch kennt (Attacken, Level, Belohnung), liegt seine
-- Beschreibung bei der Kampfzeile statt in der Registry.
ALTER TABLE battles ADD COLUMN opponent_def TEXT;

CREATE TABLE arena_runs (
  trainer_id  TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  game_date   TEXT NOT NULL,
  tier        TEXT NOT NULL,
  type_id     TEXT NOT NULL,
  round       INTEGER NOT NULL DEFAULT 1,
  wins        INTEGER NOT NULL DEFAULT 0,
  finished    INTEGER NOT NULL DEFAULT 0,
  battle_id   TEXT,
  started_at  INTEGER NOT NULL
) STRICT;

-- Ein vollständiger Durchlauf zahlt einmal am Tag je Stufe. Ohne diese Zeile
-- wäre die Arena die nächste Druckerpresse.
CREATE TABLE arena_clears (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  game_date  TEXT NOT NULL,
  tier       TEXT NOT NULL,
  cleared_at INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, game_date, tier)
) STRICT;
