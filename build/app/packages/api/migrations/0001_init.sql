-- Grundgerüst: Trainer, Zugang, Sessions, Kreaturen, Inventar, Protokoll.
-- Spätere Phasen ergänzen eigene Migrationsdateien; diese hier wird nie editiert.

CREATE TABLE trainers (
  id                TEXT PRIMARY KEY,
  telegram_id       TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  trainer_code      TEXT NOT NULL UNIQUE,
  locale            TEXT NOT NULL DEFAULT 'de',
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  gold              INTEGER NOT NULL DEFAULT 0,
  shards            INTEGER NOT NULL DEFAULT 0,
  tickets           INTEGER NOT NULL DEFAULT 0,
  current_area_id   TEXT,
  garden_background TEXT NOT NULL DEFAULT 'classic',
  is_admin          INTEGER NOT NULL DEFAULT 0,
  is_banned         INTEGER NOT NULL DEFAULT 0,
  hide_leaderboard  INTEGER NOT NULL DEFAULT 0,
  friends_only      INTEGER NOT NULL DEFAULT 0,
  allow_requests    INTEGER NOT NULL DEFAULT 1,
  reminders         INTEGER NOT NULL DEFAULT 0
) STRICT;

-- Zugang ist einladungsbasiert. Ein Code kann mehrfach nutzbar sein (max_uses)
-- und/oder ablaufen; verbraucht wird er über invite_redemptions.
CREATE TABLE invites (
  code           TEXT PRIMARY KEY,
  created_by     TEXT REFERENCES trainers(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,
  max_uses       INTEGER NOT NULL DEFAULT 1,
  uses           INTEGER NOT NULL DEFAULT 0,
  note           TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE invite_redemptions (
  code        TEXT NOT NULL REFERENCES invites(code) ON DELETE CASCADE,
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code, trainer_id)
) STRICT;

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX idx_sessions_trainer ON sessions(trainer_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE creatures (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_id       TEXT NOT NULL,
  nickname         TEXT,
  xp               INTEGER NOT NULL DEFAULT 0,
  level            INTEGER NOT NULL DEFAULT 1,
  nature           TEXT NOT NULL,
  iv_hp INTEGER NOT NULL, iv_atk INTEGER NOT NULL, iv_def INTEGER NOT NULL,
  iv_spa INTEGER NOT NULL, iv_spd INTEGER NOT NULL, iv_spe INTEGER NOT NULL,
  ev_hp INTEGER NOT NULL DEFAULT 0, ev_atk INTEGER NOT NULL DEFAULT 0, ev_def INTEGER NOT NULL DEFAULT 0,
  ev_spa INTEGER NOT NULL DEFAULT 0, ev_spd INTEGER NOT NULL DEFAULT 0, ev_spe INTEGER NOT NULL DEFAULT 0,
  friendship       INTEGER NOT NULL DEFAULT 70,
  energy           INTEGER NOT NULL DEFAULT 100,
  hp_current       INTEGER NOT NULL DEFAULT 0,
  shiny            INTEGER NOT NULL DEFAULT 0,
  moves            TEXT NOT NULL DEFAULT '[]',   -- JSON-Array mit max. 4 move-ids
  held_item        TEXT,
  caught_at        INTEGER NOT NULL,
  caught_area_id   TEXT,
  team_slot        INTEGER,                      -- NULL = eingelagert, 0..4 = Gartenteam
  CHECK (team_slot IS NULL OR (team_slot >= 0 AND team_slot <= 4))
) STRICT;
CREATE INDEX idx_creatures_owner ON creatures(owner_id);
-- Ein Slot darf pro Trainer nur einmal belegt sein; NULL zaehlt in SQLite nicht mit.
CREATE UNIQUE INDEX idx_creatures_team_slot ON creatures(owner_id, team_slot) WHERE team_slot IS NOT NULL;

CREATE TABLE inventory (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, item_id),
  CHECK (quantity >= 0)
) STRICT;

-- Erster Fang je Art, unabhaengig davon ob die Kreatur noch im Besitz ist.
CREATE TABLE dex_entries (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_id TEXT NOT NULL,
  seen_at    INTEGER,
  caught_at  INTEGER,
  PRIMARY KEY (trainer_id, species_id)
) STRICT;

-- Tageszaehler fuer alles mit Limit (Pflegeaktionen, Freibaelle, ...).
-- game_date ist das lokale Datum in Europe/Berlin, damit der Reset um
-- Mitternacht deutscher Zeit passiert und nicht um 01:00 im Sommer.
CREATE TABLE daily_counters (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  game_date  TEXT NOT NULL,
  counter    TEXT NOT NULL,
  value      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, game_date, counter)
) STRICT;

CREATE TABLE rate_limits (
  trainer_id  TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, bucket)
) STRICT;

-- Jede zustandsaendernde Aktion landet hier: Grundlage fuer Anti-Cheat-
-- Auswertung und fuer den DSGVO-Export.
CREATE TABLE event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id TEXT,
  at         INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE INDEX idx_event_log_trainer ON event_log(trainer_id, at);
CREATE INDEX idx_event_log_kind ON event_log(kind, at);
