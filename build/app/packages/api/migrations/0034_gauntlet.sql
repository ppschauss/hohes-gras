-- Die Kampfzone: eine Serie gegen wilde Pokémon, ohne festes Ende.
--
-- Ein laufender Durchgang je Trainer, wie in der Arena. Zwei gleichzeitig
-- wären zwei Serien, und die Serie ist der ganze Sinn.
CREATE TABLE gauntlet_runs (
  trainer_id TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  region_id  TEXT NOT NULL,
  -- Wie viele Siege in Folge. Eine Niederlage beendet den Lauf.
  streak     INTEGER NOT NULL DEFAULT 0,
  battle_id  TEXT,
  started_at INTEGER NOT NULL
) STRICT;

-- Die beste Serie je Region. Bleibt stehen, wenn der Lauf endet — sonst gäbe
-- es nichts, worauf man hinarbeitet, sobald man einmal verloren hat.
CREATE TABLE gauntlet_bests (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  region_id  TEXT NOT NULL,
  best       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, region_id)
) STRICT;
