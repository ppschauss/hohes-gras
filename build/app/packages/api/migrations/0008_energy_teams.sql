-- Trainer-Energie und mehrere Teams.
--
-- Zwei Aenderungen, die zusammengehoeren: die Tageslimits fallen weg und werden
-- durch eine Energie-Waehrung ersetzt, und das eine feste Gartenteam wird zu
-- beliebig vielen benannten Teams, von denen genau eines aktiv ist.

ALTER TABLE trainers ADD COLUMN energy INTEGER NOT NULL DEFAULT 120;
ALTER TABLE trainers ADD COLUMN energy_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trainers ADD COLUMN active_team_id TEXT;

-- Ein Team ist eine benannte, geordnete Auswahl. Eine Kreatur darf in mehreren
-- Teams stehen; erst beim Aktivieren wird daraus das Gartenteam
-- (creatures.team_slot), das der Rest des Spiels liest.
CREATE TABLE teams (
  id         TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_teams_trainer ON teams(trainer_id);

CREATE TABLE team_members (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot        INTEGER NOT NULL,
  creature_id TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, slot),
  CHECK (slot >= 0 AND slot <= 4)
) STRICT;
-- Dieselbe Kreatur zweimal im selben Team waere ein stiller Datenfehler.
CREATE UNIQUE INDEX idx_team_members_unique ON team_members(team_id, creature_id);
CREATE INDEX idx_team_members_creature ON team_members(creature_id);

-- Ein abgeschlossenes Gebiet (alle dort vorkommenden Arten gefangen) gibt einmalig
-- Energie. Ohne diese Tabelle gaebe es sie bei jedem Fang erneut.
CREATE TABLE area_completions (
  trainer_id   TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  area_id      TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, area_id)
) STRICT;

-- Bestandsdaten uebernehmen: jeder Trainer bekommt sein bisheriges Gartenteam
-- als "Team 1", und dieses wird sein aktives Team.
INSERT INTO teams (id, trainer_id, name, created_at)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
  ),
  id, 'Team 1', COALESCE(created_at, 0)
FROM trainers;

UPDATE trainers SET active_team_id = (SELECT t.id FROM teams t WHERE t.trainer_id = trainers.id);

INSERT INTO team_members (team_id, slot, creature_id)
SELECT t.id, c.team_slot, c.id
FROM creatures c
JOIN teams t ON t.trainer_id = c.owner_id
WHERE c.team_slot IS NOT NULL;

-- Energie startet gefuellt und ab jetzt laufend.
UPDATE trainers SET energy_updated_at = COALESCE(last_seen_at, 0);
