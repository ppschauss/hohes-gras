-- Anmeldung im Browser über einen Einmalcode aus Telegram.
--
-- Der Browser hat kein initData: die Mini-App bekommt ihre Identität von
-- Telegram signiert geliefert, eine normale Webseite nicht. Statt ein zweites
-- Passwortsystem zu bauen, leiht sich der Browser die Identität einmalig aus
-- dem Chat, der ohnehin schon authentifiziert ist.
CREATE TABLE IF NOT EXISTS link_codes (
  code_hash  TEXT PRIMARY KEY,
  trainer_id TEXT    NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_link_codes_trainer ON link_codes(trainer_id);
CREATE INDEX IF NOT EXISTS idx_link_codes_expiry ON link_codes(expires_at);

-- Sitzungen bekommen eine Identität, die man herzeigen kann.
--
-- Der Primärschlüssel ist der Token-Hash; der taugt nicht als Kennung für die
-- Oberfläche. Eine eigene id lässt sich anzeigen und widerrufen, ohne dass
-- irgendwo ein Ableger des Tokens auftaucht.
ALTER TABLE sessions ADD COLUMN id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;

-- Bestandssitzungen bekommen ihre Kennung nachgereicht. Ohne das wäre die
-- Liste für alle, die gerade angemeldet sind, eine Sammlung leerer Strings.
UPDATE sessions SET id = lower(hex(randomblob(16))) WHERE id = '';
UPDATE sessions SET last_seen_at = issued_at WHERE last_seen_at = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_id ON sessions(id);
