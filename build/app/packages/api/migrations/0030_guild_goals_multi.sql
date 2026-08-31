-- Drei Wochenziele statt einem.
--
-- Der Primärschlüssel stand auf (Gilde, Woche) und ließ damit genau ein Ziel
-- je Woche zu. Gemeldet wurde, dass ein großes Ziel „zu heftig" ist — die
-- Antwort darauf war nicht „leichter", sondern „mehr davon, kleiner". Dafür
-- muss die Art mit in den Schlüssel.
--
-- SQLite kann einen Primärschlüssel nicht ändern, also neu aufbauen und
-- umkopieren. Laufende Ziele bleiben dabei erhalten.
CREATE TABLE guild_goals_neu (
  guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  week_key   TEXT NOT NULL,
  goal_kind  TEXT NOT NULL,
  target     INTEGER NOT NULL,
  progress   INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  PRIMARY KEY (guild_id, week_key, goal_kind)
) STRICT;

INSERT INTO guild_goals_neu (guild_id, week_key, goal_kind, target, progress, claimed_at)
  SELECT guild_id, week_key, goal_kind, target, progress, claimed_at FROM guild_goals;

DROP TABLE guild_goals;
ALTER TABLE guild_goals_neu RENAME TO guild_goals;
