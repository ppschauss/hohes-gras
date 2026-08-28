-- Dynamische Levelskalierung: Gebiete und Trainer heben sich auf die Staerke
-- des Teams. Standardmaessig an; abschaltbar, weil es eine Geschmacksfrage ist,
-- ob man eine frueher besuchte Route noch einmal ernst nehmen will.
ALTER TABLE trainers ADD COLUMN level_scaling INTEGER NOT NULL DEFAULT 1;
