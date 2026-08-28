-- Kaempfe. Der Zustand liegt als JSON, weil er tief verschachtelt ist und
-- ausschliesslich als Ganzes gelesen und geschrieben wird; ihn auf Tabellen zu
-- verteilen wuerde nur Joins erzeugen, die niemand braucht.
CREATE TABLE battles (
  id           TEXT PRIMARY KEY,
  trainer_id   TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,          -- trainer | gym | pvp | raid
  opponent_id  TEXT,                   -- Trainer-Id aus dem Content-Pack
  area_id      TEXT,
  seed         TEXT NOT NULL,
  state        TEXT NOT NULL,          -- JSON: BattleState
  events       TEXT NOT NULL DEFAULT '[]',  -- JSON: alle bisherigen Ereignisse
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  winner       INTEGER,                -- 0 = Spieler, 1 = Gegner, NULL = offen/unentschieden
  rewarded     INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_battles_trainer ON battles(trainer_id, finished_at);

-- Besiegte Trainer. Wiederholungssiege zahlen weniger; ohne diese Tabelle
-- waere der leichteste Trainer der beste Goldautomat.
CREATE TABLE trainer_defeats (
  trainer_id     TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  opponent_id    TEXT NOT NULL,
  first_win_at   INTEGER NOT NULL,
  wins           INTEGER NOT NULL DEFAULT 1,
  last_win_at    INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, opponent_id)
) STRICT;
