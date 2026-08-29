-- Tägliche Geschenke unter Freunden.
--
-- Der Inhalt wird beim Senden gewürfelt und mitgeschrieben, nicht erst beim
-- Öffnen: sonst hinge er davon ab, wann der Empfänger hineinschaut, und zwei
-- Spieler mit derselben Nachricht bekämen verschiedene Dinge.
CREATE TABLE friend_gifts (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  game_date  TEXT NOT NULL,
  payload    TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  opened_at  INTEGER
) STRICT;

-- Ein Geschenk je Freund und Tag. Die Schranke steht in der Datenbank und
-- nicht nur im Dienst: zwei gleichzeitige Anfragen kämen sonst beide durch.
CREATE UNIQUE INDEX friend_gifts_daily ON friend_gifts (from_id, to_id, game_date);
CREATE INDEX friend_gifts_inbox ON friend_gifts (to_id, opened_at);
