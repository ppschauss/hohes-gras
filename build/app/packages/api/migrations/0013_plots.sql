-- Poke-Beet: vergrabene Gegenstaende oder Gold, die mit Pflege mehr zurueckgeben.
CREATE TABLE garden_plots (
  id            TEXT PRIMARY KEY,
  trainer_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  slot          INTEGER NOT NULL,
  -- 'item' oder 'gold'. Bei 'gold' bleibt item_id leer.
  stake_kind    TEXT NOT NULL,
  item_id       TEXT,
  amount        INTEGER NOT NULL,
  planted_at    INTEGER NOT NULL,
  ready_at      INTEGER NOT NULL,
  phases_done   INTEGER NOT NULL DEFAULT 0,
  -- Abgestelltes Pflanzen-Pokemon. Wird es abgegeben oder freigelassen,
  -- verliert das Beet nur seinen Pfleger, nicht seinen Inhalt.
  tender_id     TEXT REFERENCES creatures(id) ON DELETE SET NULL,
  harvested_at  INTEGER,
  CHECK (stake_kind IN ('item', 'gold')),
  CHECK (amount > 0)
) STRICT;
CREATE INDEX idx_garden_plots_open ON garden_plots(trainer_id, harvested_at);
-- Ein Beet je Platz, solange es nicht geerntet ist.
CREATE UNIQUE INDEX idx_garden_plots_slot ON garden_plots(trainer_id, slot) WHERE harvested_at IS NULL;
