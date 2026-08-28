-- Freundschaften, Tausch und Rangliste.

-- Eine Freundschaft ist eine Zeile, kein Paar von Zeilen: der kleinere der
-- beiden Ids steht immer links. Sonst muesste jede Abfrage beide Richtungen
-- pruefen und jede Aenderung zwei Zeilen konsistent halten.
CREATE TABLE friendships (
  low_id     TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  high_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id)
) STRICT;

CREATE TABLE friend_requests (
  from_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id),
  CHECK (from_id != to_id)
) STRICT;
CREATE INDEX idx_friend_requests_to ON friend_requests(to_id);

-- Oeffentlicher Marktplatz. Ein Angebot bindet genau ein Pokemon; solange es
-- gelistet ist, darf es nicht im Team stehen oder auf Expedition sein.
CREATE TABLE market_listings (
  id           TEXT PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  creature_id  TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  price        INTEGER NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  sold_at      INTEGER,
  buyer_id     TEXT REFERENCES trainers(id) ON DELETE SET NULL,
  cancelled_at INTEGER,
  CHECK (price > 0)
) STRICT;
CREATE UNIQUE INDEX idx_market_open_creature ON market_listings(creature_id)
  WHERE sold_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX idx_market_open ON market_listings(sold_at, cancelled_at, created_at);

-- Direkter Tausch zwischen zwei Trainern. Beide muessen bestaetigen.
CREATE TABLE trade_offers (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  to_id         TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  offered_id    TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  requested_id  TEXT REFERENCES creatures(id) ON DELETE CASCADE,
  message       TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  declined_at   INTEGER
) STRICT;
CREATE INDEX idx_trade_to ON trade_offers(to_id, accepted_at, declined_at);
CREATE INDEX idx_trade_from ON trade_offers(from_id, accepted_at, declined_at);

-- Ranglisten-Kennzahlen. Als eigene Tabelle statt als Abfrage ueber alles,
-- weil sie bei jedem Fang und jedem Kampf fortgeschrieben werden und die
-- Rangliste sonst mit jedem Aufruf die halbe Datenbank scannen wuerde.
CREATE TABLE leaderboard_stats (
  trainer_id     TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  dex_caught     INTEGER NOT NULL DEFAULT 0,
  badges         INTEGER NOT NULL DEFAULT 0,
  battles_won    INTEGER NOT NULL DEFAULT 0,
  battles_lost   INTEGER NOT NULL DEFAULT 0,
  shinies        INTEGER NOT NULL DEFAULT 0,
  highest_level  INTEGER NOT NULL DEFAULT 0,
  team_power     INTEGER NOT NULL DEFAULT 0,
  score          INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_leaderboard_score ON leaderboard_stats(score DESC);
