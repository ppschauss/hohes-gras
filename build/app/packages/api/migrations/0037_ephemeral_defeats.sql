-- Die Siege über Kunstgegner wieder herauswerfen.
--
-- Arena und Kampfzone stellen für jeden Kampf einen eigenen Gegner auf
-- (`arena-2026-08-31-hard-3`, `gauntlet-hoenn-42`). Deren Siege landeten in
-- `trainer_defeats` und blieben dort für immer: gemessen 119 solcher Zeilen
-- gegen 39 echte Trainer, und keine davon wird je wieder gelesen.
--
-- Ab jetzt werden sie gar nicht erst vermerkt; das hier räumt die alten weg.
DELETE FROM trainer_defeats
 WHERE opponent_id LIKE 'arena-%' OR opponent_id LIKE 'gauntlet-%';
