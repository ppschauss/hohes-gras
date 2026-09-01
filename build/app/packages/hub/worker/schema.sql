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
  code        TEXT NOT NULL DEFAULT '',
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

-- Freundschaften über Instanzgrenzen. Immer sortiert, damit ein Paar genau
-- eine Zeile hat und die Richtung keine Rolle spielt.
CREATE TABLE IF NOT EXISTS friends (
  low_id     TEXT NOT NULL,
  high_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_requests_to ON friend_requests(to_id);
-- Der Trainer-Code, mit dem man jemanden ueber Instanzgrenzen findet.
--
-- Stand frueher als nacktes `ALTER TABLE` am Dateiende. SQLite kennt kein
-- `ADD COLUMN IF NOT EXISTS`, also brach der zweite Lauf mit "duplicate column
-- name" ab — und zwar *bevor* die Tabellen darunter angelegt wurden. Die
-- Datei behauptete im Kommentar, wiederholbar zu sein, und war es nicht.
-- Jetzt steht die Spalte in der Tabelle; bestehende Datenbanken haben sie
-- laengst.
CREATE INDEX IF NOT EXISTS idx_trainers_code ON trainers(code);

-- Der Aushang des Verbunds.
--
-- Nur Abschriften: die Kreatur bleibt auf ihrer Heimatinstanz, hier steht,
-- wie sie aussieht und was sie kosten soll. Gekauft wird in diesem Schritt
-- noch nicht — deshalb wandert auch nichts herueber, was man faelschen
-- koennte.
--
-- Eine Instanz schickt ihren ganzen Aushang; was verkauft oder zurueckgezogen
-- wurde, verschwindet dadurch von selbst.
CREATE TABLE IF NOT EXISTS market (
  id           TEXT NOT NULL,
  instance_id  TEXT NOT NULL,
  trainer_id   TEXT NOT NULL,
  seller_name  TEXT NOT NULL,
  price        INTEGER NOT NULL,
  note         TEXT NOT NULL,
  species_name TEXT NOT NULL,
  level        INTEGER NOT NULL,
  shiny        INTEGER NOT NULL,
  iv_percent   INTEGER NOT NULL,
  sprite       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS idx_market_time ON market(created_at);

-- Bestellungen ueber Instanzgrenzen.
--
-- Getrennt vom Aushang, weil eine Instanz ihren Aushang bei jedem Abgleich
-- vollstaendig ersetzt. Ein Kaufvertrag darf davon nicht mitgerissen werden:
-- er ueberlebt es, wenn das Schaufenster umgeraeumt wird.
CREATE TABLE IF NOT EXISTS market_orders (
  id                  TEXT PRIMARY KEY,
  listing_id          TEXT NOT NULL,
  seller_instance_id  TEXT NOT NULL,
  seller_trainer_id   TEXT NOT NULL,
  buyer_instance_id   TEXT NOT NULL,
  buyer_trainer_id    TEXT NOT NULL,
  price               INTEGER NOT NULL,
  -- reserved -> delivered -> collected, oder aborted.
  status              TEXT NOT NULL,
  -- Das Pokemon, ab 'delivered'. Text: der Verbund kennt keine Kreaturen.
  creature            TEXT,
  reason              TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
-- Beide Seiten fragen nach dem, was sie angeht.
CREATE INDEX IF NOT EXISTS idx_orders_seller ON market_orders(seller_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON market_orders(buyer_instance_id, status);
-- Fuer die Pruefung "gibt es zu diesem Angebot schon eine offene Bestellung".
CREATE INDEX IF NOT EXISTS idx_orders_listing ON market_orders(listing_id, status);
