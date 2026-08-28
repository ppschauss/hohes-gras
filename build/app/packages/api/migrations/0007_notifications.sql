-- Telegram-Erinnerungen. Getrennt vom Ereignisprotokoll, weil hier nicht
-- steht was passiert ist, sondern was der Bot schon gesagt hat — und genau
-- das entscheidet, ob er nochmal schreiben darf.
CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id  TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  sent_at     INTEGER NOT NULL,
  game_date   TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE INDEX idx_notifications_trainer_day ON notifications(trainer_id, game_date);
