-- Entwicklung, Basisausbau, Handwerk, Saison-Reise und Erfolge.

-- Gebaeude im Garten. Jedes gibt einen passiven Bonus, der mit der Stufe
-- waechst; die Wirkung selbst steht in der Engine, hier nur der Ausbaustand.
CREATE TABLE buildings (
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  building_id TEXT NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  built_at    INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, building_id),
  CHECK (level >= 1)
) STRICT;

-- Saison-Reise: ein Fortschrittspfad pro Saison mit einlösbaren Stufen.
CREATE TABLE season_progress (
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  season_key  TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  claimed     TEXT NOT NULL DEFAULT '[]',   -- JSON-Array eingelöster Stufen
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, season_key)
) STRICT;

CREATE TABLE achievements (
  trainer_id     TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  progress       INTEGER NOT NULL DEFAULT 0,
  unlocked_at    INTEGER,
  claimed_at     INTEGER,
  PRIMARY KEY (trainer_id, achievement_id)
) STRICT;
CREATE INDEX idx_achievements_unlocked ON achievements(trainer_id, unlocked_at);

-- Story: welches Kapitel ein Trainer erreicht hat.
CREATE TABLE story_progress (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  reached_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (trainer_id, chapter_id)
) STRICT;
