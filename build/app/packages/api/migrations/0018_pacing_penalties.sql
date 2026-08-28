-- Zwangspausen der Taktkontrolle.
--
-- Ohne gespeicherte Pause ist die angekündigte Wartezeit eine Falschaussage:
-- ein abgewiesener Versuch wird nicht mitgeschrieben, also sieht die
-- Rhythmusprobe dreißig Sekunden später dieselben Abstände und weist wieder ab.
-- Die Sperre hielt damit bis die Zeitpunkte aus dem Viertelstundenfenster
-- fielen — angekündigt waren dreißig Sekunden.
CREATE TABLE IF NOT EXISTS pacing_penalties (
  trainer_id TEXT    NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  bucket     TEXT    NOT NULL,
  until      INTEGER NOT NULL,
  reason     TEXT    NOT NULL,
  set_at     INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, bucket)
) STRICT;
