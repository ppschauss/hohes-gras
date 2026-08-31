-- Tages- und Wochenaufgaben.
--
-- Eine Zeile je Spieler, Zeitraum und Aufgabe. Der Zeitraum steht als Schlüssel
-- darin („2026-08-31" oder „2026-W35") und nicht als Zeitstempel: ein neuer Tag
-- hat einfach noch keine Zeile, also kann nichts verpasst werden, wenn der
-- Server um Mitternacht gerade nicht lief. Dasselbe Verfahren wie beim
-- Gildenziel.
CREATE TABLE IF NOT EXISTS quests (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  quest_id   TEXT NOT NULL,
  progress   INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  PRIMARY KEY (trainer_id, period_key, quest_id)
) STRICT;

CREATE INDEX IF NOT EXISTS quests_open ON quests (trainer_id, period_key);
