-- Welt, Fang, Expeditionen und Zucht.

-- Verdiente Orden. Getrennt von den Trainern, weil ein Orden ein Ereignis mit
-- Zeitpunkt ist und spaeter in der Trainerkarte auftauchen soll.
CREATE TABLE trainer_badges (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  badge_id   TEXT NOT NULL,
  earned_at  INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, badge_id)
) STRICT;

-- Besuchte Gebiete. Das Freischalten selbst wird aus Faengen und Orden
-- berechnet; hier steht nur, was der Trainer tatsaechlich schon betreten hat.
CREATE TABLE area_progress (
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  area_id     TEXT NOT NULL,
  first_visit INTEGER NOT NULL,
  last_visit  INTEGER NOT NULL,
  encounters  INTEGER NOT NULL DEFAULT 0,
  catches     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, area_id)
) STRICT;

-- Genau eine offene Begegnung pro Trainer. Der Primaerschluessel erzwingt das:
-- zwei parallele Safaris waeren sonst ein Weg, Baelle doppelt einzusetzen.
CREATE TABLE active_encounter (
  trainer_id    TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  area_id       TEXT NOT NULL,
  species_id    TEXT NOT NULL,
  level         INTEGER NOT NULL,
  shiny         INTEGER NOT NULL DEFAULT 0,
  turn          INTEGER NOT NULL DEFAULT 0,
  weaken_stacks INTEGER NOT NULL DEFAULT 0,
  calm_stacks   INTEGER NOT NULL DEFAULT 0,
  seed          TEXT NOT NULL,
  started_at    INTEGER NOT NULL
) STRICT;

-- Fangserien je Art, Grundlage der steigenden Shiny-Chance.
CREATE TABLE catch_chains (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_id TEXT NOT NULL,
  streak     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, species_id)
) STRICT;

CREATE TABLE expeditions (
  id          TEXT PRIMARY KEY,
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  duration    TEXT NOT NULL,
  area_id     TEXT NOT NULL,
  party       TEXT NOT NULL,          -- JSON-Array mit creature-ids
  seed        TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  collected_at INTEGER
) STRICT;
CREATE INDEX idx_expeditions_trainer ON expeditions(trainer_id, collected_at);

CREATE TABLE eggs (
  id            TEXT PRIMARY KEY,
  trainer_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_id    TEXT NOT NULL,
  nature        TEXT NOT NULL,
  iv_hp INTEGER NOT NULL, iv_atk INTEGER NOT NULL, iv_def INTEGER NOT NULL,
  iv_spa INTEGER NOT NULL, iv_spd INTEGER NOT NULL, iv_spe INTEGER NOT NULL,
  shiny         INTEGER NOT NULL DEFAULT 0,
  hatch_minutes INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  hatched_at    INTEGER,
  parent_a      TEXT,
  parent_b      TEXT
) STRICT;
CREATE INDEX idx_eggs_trainer ON eggs(trainer_id, hatched_at);
