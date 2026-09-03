-- Wann ein Beleg zurueckgenommen wurde.
--
-- Ohne diese Spalte liess sich dieselbe Ruecknahme beliebig oft ausfuehren.
-- Bei einer Kreatur faellt das auf — die Zeile ist beim zweiten Mal weg. Bei
-- Gegenstaenden und Gold nicht: dort wird gegen den *aktuellen* Bestand
-- gerechnet, und ein zweiter Lauf zieht dieselben 5.000 Gold noch einmal ab,
-- diesmal aus rechtmaessig verdientem Einkommen.
--
-- Der Kommentar im Werkzeug behauptete, das falle von selbst auf. Das stimmte
-- nur fuer Kreaturen.
ALTER TABLE acquisitions ADD COLUMN undone_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_acq_undone ON acquisitions (undone_at);
