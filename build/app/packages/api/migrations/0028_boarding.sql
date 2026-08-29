-- Die Pension.
--
-- Eine Zeile je abgegebenem Pokémon. `level_at_start` hält fest, wo es beim
-- Abgeben stand: der Ertrag ist eine Zahl von Leveln, und ohne diesen Anker
-- ließe er sich nach einem Levelaufstieg im Kampf nicht mehr berechnen —
-- kämpfen kann es zwar nicht, aber ein Trank, ein Bonbon oder eine Forschung
-- könnten es trotzdem verändern.
CREATE TABLE IF NOT EXISTS boarding (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  creature_id TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  level_at_start INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ready_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS boarding_creature ON boarding (creature_id);
CREATE INDEX IF NOT EXISTS boarding_trainer ON boarding (trainer_id);
