-- Jedes bestehende Konto bekommt einmalig Kampfmedizin.
--
-- Gegenstände lassen sich ab jetzt mitten im Kampf einsetzen. Wer schon spielt,
-- hat aber nur die drei Tränke aus dem alten Startpaket — und ein Kampf, in dem
-- man nur zusehen kann, wie das Team fällt, ist kein Kampf, sondern ein
-- Countdown.
--
-- Aufgeschlagen, nicht gesetzt: wer schon Tränke hat, verliert keine.
INSERT INTO inventory (trainer_id, item_id, quantity)
SELECT t.id, k.item_id, k.qty
FROM trainers t
JOIN (
  SELECT 'potion' AS item_id, 5 AS qty
  UNION ALL SELECT 'super-potion', 3
  UNION ALL SELECT 'revive', 2
  UNION ALL SELECT 'full-heal', 2
) k
-- `WHERE true` ist Pflicht, kein Zierrat: bei INSERT … SELECT kann SQLite die
-- ON-CONFLICT-Klausel sonst nicht vom SELECT trennen.
WHERE true
ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = inventory.quantity + excluded.quantity;
