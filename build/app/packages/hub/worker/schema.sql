-- Schema des Verbunds (Cloudflare D1).
--
-- Absichtlich klein. Hier liegen Identitäten und Schnappschüsse, kein
-- Spielstand: eine Instanz, die den Verbund verliert, verliert nichts, was
-- sie nicht selbst hat. Warum es so geschnitten ist, steht in docs/VERBUND.md.

CREATE TABLE IF NOT EXISTS instances (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  secret     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 'read' darf lesen und die eigenen Trainer melden, 'trade' zusätzlich
  -- handeln. Neue Instanzen fangen unten an.
  trust      TEXT NOT NULL DEFAULT 'read',
  blocked_at INTEGER
);

CREATE TABLE IF NOT EXISTS trainers (
  id          TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances(id),
  display_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trainers_instance ON trainers(instance_id);

CREATE TABLE IF NOT EXISTS profiles (
  trainer_id  TEXT PRIMARY KEY REFERENCES trainers(id),
  badges      INTEGER NOT NULL DEFAULT 0,
  dex_caught  INTEGER NOT NULL DEFAULT 0,
  battles_won INTEGER NOT NULL DEFAULT 0,
  rating      INTEGER NOT NULL DEFAULT 0,
  level       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- Der Stand, den alle Instanzen fahren sollten. Genau eine Zeile.
CREATE TABLE IF NOT EXISTS releases (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  sha          TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL
);

-- Der globale Chat. Ein Raum für den ganzen Verbund.
--
-- Der Name steht mit in der Zeile und wird nicht beim Lesen nachgeschlagen:
-- wer sich umbenennt, ändert damit nicht rückwirkend, was er gesagt hat.
CREATE TABLE IF NOT EXISTS chat (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id  TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_instance_time ON chat(instance_id, created_at);
