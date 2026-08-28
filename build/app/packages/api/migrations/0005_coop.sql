-- Gilden, Raids, PvP und Turniere.

CREATE TABLE guilds (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  tag          TEXT NOT NULL UNIQUE,     -- kurzes Kuerzel, 2-5 Zeichen
  motto        TEXT NOT NULL DEFAULT '',
  founder_id   TEXT REFERENCES trainers(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  treasury     INTEGER NOT NULL DEFAULT 0,
  -- Optional an einen Telegram-Gruppenchat gebunden: dorthin postet der Bot
  -- die Raid-Karten.
  chat_id      TEXT,
  join_open    INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX idx_guilds_chat ON guilds(chat_id);

CREATE TABLE guild_members (
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  trainer_id   TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',   -- leader | member
  joined_at    INTEGER NOT NULL,
  contribution INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, trainer_id)
) STRICT;
-- Ein Trainer gehoert zu hoechstens einer Gilde.
CREATE UNIQUE INDEX idx_guild_member_unique ON guild_members(trainer_id);

-- Wochenziel der Gemeinschaft. week_key ist ISO-Jahr-Woche, damit der Reset
-- ohne Cronjob passiert: eine neue Woche ist einfach eine neue Zeile.
CREATE TABLE guild_goals (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  week_key   TEXT NOT NULL,
  goal_kind  TEXT NOT NULL,
  target     INTEGER NOT NULL,
  progress   INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  PRIMARY KEY (guild_id, week_key)
) STRICT;

-- Raid-Bosse. Ein Raid gehoert entweder zu einer Gilde oder zu einem Chat.
CREATE TABLE raids (
  id             TEXT PRIMARY KEY,
  guild_id       TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  chat_id        TEXT,
  message_id     INTEGER,
  species_id     TEXT NOT NULL,
  level          INTEGER NOT NULL,
  tier           INTEGER NOT NULL,
  hp_max         INTEGER NOT NULL,
  hp_left        INTEGER NOT NULL,
  seed           TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  defeated_at    INTEGER,
  rewards_paid   INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_raids_open ON raids(defeated_at, expires_at);
CREATE INDEX idx_raids_guild ON raids(guild_id, defeated_at);

CREATE TABLE raid_participants (
  raid_id     TEXT NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  damage      INTEGER NOT NULL DEFAULT 0,
  attacks     INTEGER NOT NULL DEFAULT 0,
  joined_at   INTEGER NOT NULL,
  rewarded_at INTEGER,
  PRIMARY KEY (raid_id, trainer_id)
) STRICT;

-- Asynchrones PvP. Der Gegner spielt nicht mit; gekaempft wird gegen eine
-- Momentaufnahme seines Teams, damit niemand online sein muss.
CREATE TABLE pvp_ratings (
  trainer_id TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL DEFAULT 1000,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  streak     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_pvp_rating ON pvp_ratings(rating DESC);

CREATE TABLE pvp_duels (
  id             TEXT PRIMARY KEY,
  challenger_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  defender_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  seed           TEXT NOT NULL,
  events         TEXT NOT NULL DEFAULT '[]',
  winner         INTEGER,
  rating_delta   INTEGER NOT NULL DEFAULT 0,
  fought_at      INTEGER NOT NULL,
  seen_by_defender INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_duels_defender ON pvp_duels(defender_id, seen_by_defender);
CREATE INDEX idx_duels_challenger ON pvp_duels(challenger_id, fought_at);

-- Wochenturnier. Die Runden werden serverseitig aufgeloest.
CREATE TABLE tournaments (
  week_key    TEXT PRIMARY KEY,
  state       TEXT NOT NULL DEFAULT 'open',   -- open | running | finished
  created_at  INTEGER NOT NULL,
  closes_at   INTEGER NOT NULL,
  resolved_at INTEGER,
  bracket     TEXT NOT NULL DEFAULT '[]'
) STRICT;

CREATE TABLE tournament_entries (
  week_key   TEXT NOT NULL REFERENCES tournaments(week_key) ON DELETE CASCADE,
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  team       TEXT NOT NULL,       -- JSON-Momentaufnahme
  seed_score INTEGER NOT NULL,
  placement  INTEGER,
  reward_paid INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_key, trainer_id)
) STRICT;
