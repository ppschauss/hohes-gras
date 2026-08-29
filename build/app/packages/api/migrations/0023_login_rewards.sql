-- Tägliche Anmeldebelohnung.
--
-- Eine Zeile je Trainer statt einer je abgeholtem Tag: die Leiter ist ein
-- Zustand, kein Protokoll. Wer wissen will, was wann abgeholt wurde, findet es
-- im event_log — dafür ist es da.
CREATE TABLE login_rewards (
  trainer_id  TEXT PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  day         INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  claimed     INTEGER NOT NULL DEFAULT 0,
  last_date   TEXT
) STRICT;
