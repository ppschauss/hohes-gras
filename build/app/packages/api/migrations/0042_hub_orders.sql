-- Was diese Instanz an einem Kauf ueber Verbundgrenzen zu tun hat.
--
-- Der Verbund fuehrt den Vorgang; hier steht, wie weit *wir* damit sind. Beide
-- Seiten brauchen das, und zwar aus demselben Grund: zwischen "Gold abgebucht"
-- und "Pokemon da" liegt eine Leitung, die ausfallen kann. Ohne eine eigene
-- Notiz wuesste eine Instanz nach einem Neustart nicht, ob sie schon bezahlt,
-- schon geliefert oder schon erstattet hat — und wuerde es ein zweites Mal tun.
CREATE TABLE IF NOT EXISTS hub_orders (
  -- Die Kennung des Vorgangs im Verbund. Beim Kaeufer erst bekannt, wenn der
  -- Verbund geantwortet hat; bis dahin steht hier die Angebotskennung mit
  -- Praefix, damit die Zeile schon vor dem Netzaufruf existieren kann.
  id          TEXT PRIMARY KEY,
  -- 'buyer' oder 'seller'.
  role        TEXT    NOT NULL,
  listing_id  TEXT    NOT NULL,
  -- Unser Trainer: der Kaeufer bzw. der Verkaeufer.
  trainer_id  TEXT    NOT NULL,
  price       INTEGER NOT NULL,
  /*
   * Unser Stand, nicht der des Verbunds.
   *
   *   paid       Kaeufer: Gold ist weg, der Verbund weiss noch nichts davon.
   *   ordered    Kaeufer: der Verbund fuehrt den Vorgang.
   *   holding    Verkaeufer: Pokemon ist hier entfernt und liegt in `payload`.
   *   done       Erledigt.
   *   refunded   Kaeufer: Gold ist zurueck.
   */
  status      TEXT    NOT NULL,
  /*
   * Das serialisierte Pokemon.
   *
   * Beim Verkaeufer zwischen Entfernen und bestaetigter Uebergabe. Genau
   * deshalb steht es hier und nicht nur im Verbund: bricht die Leitung nach
   * dem Entfernen, ist das Pokemon nicht verloren, sondern liegt in dieser
   * Spalte und wird beim naechsten Lauf erneut angeboten.
   */
  payload     TEXT,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_hub_orders_status ON hub_orders (status);
CREATE INDEX IF NOT EXISTS idx_hub_orders_listing ON hub_orders (listing_id);
