-- Ob der Trainer-Code schon beim Verbund angekommen ist.
--
-- Trainer, die vor der Freundes-Funktion angemeldet wurden, haben dort keinen
-- Code — und ohne ihn findet sie niemand. Nachgereicht wird einmal je Trainer;
-- die Spalte merkt sich, für wen es schon erledigt ist, damit der Abgleich
-- nicht bei jedem Lauf alle noch einmal schickt.
ALTER TABLE hub_links ADD COLUMN code_pushed INTEGER NOT NULL DEFAULT 0;
