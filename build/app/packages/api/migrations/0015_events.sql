-- Ein anstehendes Ereignis aus der Safari.
--
-- Steht am Trainer statt in einer eigenen Tabelle: es gibt hoechstens eines,
-- es lebt nur bis zum naechsten Kampf, und ein Join dafuer waere Aufwand ohne
-- Gegenwert.
ALTER TABLE trainers ADD COLUMN pending_event_id TEXT;
ALTER TABLE trainers ADD COLUMN pending_event_area TEXT;
