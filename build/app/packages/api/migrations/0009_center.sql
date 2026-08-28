-- Poke-Center: kostenlose Heilung alle 15 Minuten, gelegentlich mit Ereignis.

ALTER TABLE trainers ADD COLUMN center_used_at INTEGER NOT NULL DEFAULT 0;

-- Ein Tauschangebot ist ein eigener Zustand: es entsteht bei einem Besuch,
-- steht eine Weile und wird angenommen oder abgelehnt. Ohne Tabelle waere es
-- eine Momentaufnahme, die beim naechsten Neuladen verschwindet.
CREATE TABLE center_offers (
  id                 TEXT PRIMARY KEY,
  trainer_id         TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  npc_name           TEXT NOT NULL,
  wanted_species_id  TEXT NOT NULL,
  offered_species_id TEXT NOT NULL,
  offered_level      INTEGER NOT NULL,
  offered_shiny      INTEGER NOT NULL DEFAULT 0,
  seed               TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  resolved_at        INTEGER,
  accepted           INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_center_offers_open ON center_offers(trainer_id, resolved_at, expires_at);
