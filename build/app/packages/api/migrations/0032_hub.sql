-- Verbund: die Bruecke zwischen dieser Instanz und der globalen Spielerbasis.
--
-- Beide Tabellen sind reine Beiwerk-Tabellen: loescht man sie, verliert das
-- Spiel nichts. Die globale Id laesst sich jederzeit neu erfragen, und der
-- Zwischenspeicher fuellt sich beim naechsten Blick auf die Rangliste. Genau
-- so soll es sein — der Verbund darf nie zur Voraussetzung dafuer werden,
-- dass eine Instanz laeuft.

CREATE TABLE hub_links (
  trainer_id  TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  global_id   TEXT NOT NULL,
  -- Was zuletzt hochgeschoben wurde. Aendert sich nichts, geht auch nichts
  -- hinaus; die meisten Trainer spielen an den meisten Tagen nicht.
  pushed_score INTEGER NOT NULL DEFAULT -1,
  synced_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE hub_cache (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT;
