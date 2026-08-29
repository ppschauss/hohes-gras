-- Wie viele Erkundungen noch garantiert ein Fundstück zutage fördern.
--
-- Gegenstück zum Störsender: der weiß, wo die Banden funken, dieser hier, wo
-- im Boden etwas liegt. Beides sind Regeln und keine Zahlen, deshalb steht der
-- Vorrat am Trainer und nicht im Beutel — die Anwendung ist verbraucht, sobald
-- sie eingeschaltet ist.
ALTER TABLE trainers ADD COLUMN detector_charges INTEGER NOT NULL DEFAULT 0;
