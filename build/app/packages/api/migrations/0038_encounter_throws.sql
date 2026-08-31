-- Wie oft in dieser Begegnung schon geworfen wurde.
--
-- Die Fluchtchance hing bisher am Rundenzähler — und der steigt auch beim
-- Schwächen und Beruhigen. Wer viermal vorbereitete und dann warf, stand beim
-- *ersten* Wurf schon bei 25 %. Gemeldet als vier verlorene Fangserien.
--
-- Vorbereiten ist kein Fluchtgrund: gerechnet wird ab jetzt in Würfen.
ALTER TABLE active_encounter ADD COLUMN throws INTEGER NOT NULL DEFAULT 0;
