-- Kaufbare Designs.
--
-- Besitz steht in einer eigenen Tabelle statt im Inventar: ein Design ist kein
-- Gegenstand, den man stapelt oder verkauft, sondern eine Freischaltung.
ALTER TABLE trainers ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'nachtgruen';
-- 'auto' folgt der Weltuhr, 'day'/'night' sind feste Vorgaben.
ALTER TABLE trainers ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'auto';

CREATE TABLE trainer_themes (
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  theme_id   TEXT NOT NULL,
  bought_at  INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, theme_id)
) STRICT;
