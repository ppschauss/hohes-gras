-- Forschung im Labor.
--
-- Eine Zeile je begonnenem Projekt. Abgeschlossen ist, was ein `claimed_at`
-- trägt — damit ist dieselbe Tabelle Laufzettel und Urkunde, und es braucht
-- keine zweite Liste, die mit der ersten auseinanderlaufen kann.
--
-- Bewusst ohne eindeutigen Index über (Trainer, Projekt): Training läuft
-- beliebig oft, und die Sperre gegen doppeltes Erforschen gehört in den
-- Dienst, wo sie mit einer verständlichen Meldung antworten kann.
CREATE TABLE IF NOT EXISTS research (
  id TEXT PRIMARY KEY,
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  tier INTEGER NOT NULL,
  -- Das eingesetzte Pokémon. Es ist so lange nicht verfügbar und bekommt am
  -- Ende die Erfahrung. NULL, wenn es zwischenzeitlich freigelassen wurde.
  creature_id TEXT REFERENCES creatures(id) ON DELETE SET NULL,
  -- Bei Training: auf welchen Wert die Fleißpunkte gehen.
  stat TEXT,
  started_at INTEGER NOT NULL,
  ready_at INTEGER NOT NULL,
  claimed_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS research_trainer ON research (trainer_id, claimed_at);
CREATE INDEX IF NOT EXISTS research_creature ON research (creature_id) WHERE creature_id IS NOT NULL;
