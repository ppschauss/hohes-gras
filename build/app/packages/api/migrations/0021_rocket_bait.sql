-- Wie viele Erkundungen noch garantiert in einem Überfall enden.
--
-- Der Störsender kauft die Geduld ab, die sonst nötig ist: bei 4 % je
-- Erkundung wartet man auf einen Überfall im Schnitt 25 Mal — und Überfälle
-- sind die einzige Quelle für Sagenbeeren.
ALTER TABLE trainers ADD COLUMN rocket_charges INTEGER NOT NULL DEFAULT 0;
