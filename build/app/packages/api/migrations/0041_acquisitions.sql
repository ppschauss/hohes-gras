-- Was ein Trainer bekommen hat, und wodurch.
--
-- Das Ereignisprotokoll erzaehlt, was geschah; es taugt aber nicht zum
-- Zuruecknehmen. `safari.catch` nannte Art, Level und Gold — nicht aber die
-- ID des Pokemon, das dabei entstand. Nach dem Mewtu-Vorfall liess sich
-- deshalb zwar nachlesen, *dass* sieben gefangen wurden, aber nicht, *welche*
-- sieben Zeilen in `creatures` das waren.
--
-- Diese Tabelle ist das Gegenstueck: kein Text, sondern ein Beleg. Jede Zeile
-- benennt genau eine Zuwendung, mit der Kennung, die man zum Rueckgaengig-
-- machen braucht, mit der Quelle, durch die sie entstand, und mit dem Build,
-- unter dem das passierte. Damit ist "alles, was zwischen zwei Staenden durch
-- Quelle X kam" eine Abfrage und keine Ermittlung.
CREATE TABLE IF NOT EXISTS acquisitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id  TEXT    NOT NULL,
  at          INTEGER NOT NULL,
  -- Der Git-Stand des Servers. Fehlt er, stand `GIT_SHA` nicht zur Verfuegung.
  release_sha TEXT    NOT NULL,
  -- Wodurch: 'safari.catch', 'raid.reward', 'shop.buy', ...
  source      TEXT    NOT NULL,
  -- Was: 'creature', 'item' oder 'gold'.
  kind        TEXT    NOT NULL,
  -- Die Kennung, an der es haengt: Kreatur-ID, Gegenstands-ID, bei Gold leer.
  ref         TEXT    NOT NULL,
  -- Stueckzahl, Goldmenge, bei einer Kreatur 1.
  amount      INTEGER NOT NULL,
  -- Was man beim Sichten sehen will, ohne nachschlagen zu muessen.
  detail      TEXT
) STRICT;

-- Die drei Fragen, die ein Rollback stellt: seit wann, aus welcher Quelle,
-- unter welchem Stand.
CREATE INDEX IF NOT EXISTS idx_acq_at ON acquisitions (at);
CREATE INDEX IF NOT EXISTS idx_acq_source ON acquisitions (source, at);
CREATE INDEX IF NOT EXISTS idx_acq_release ON acquisitions (release_sha, at);
CREATE INDEX IF NOT EXISTS idx_acq_trainer ON acquisitions (trainer_id, at);
