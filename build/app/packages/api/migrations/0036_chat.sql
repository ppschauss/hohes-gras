-- Der globale Chat, lokal zwischengespeichert.
--
-- Der Verbund ist die Wahrheit; das hier ist eine Kopie, damit ein Blick in
-- den Chat nicht auf eine fremde Leitung wartet und ein stummer Verbund die
-- letzten Nachrichten stehen lässt statt eines leeren Fensters.
CREATE TABLE chat_cache (
  id          INTEGER PRIMARY KEY,
  trainer_id  TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
) STRICT;
