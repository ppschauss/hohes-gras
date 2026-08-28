-- Eine Sitzung je Gerät, nicht je App-Start.
--
-- Die Mini-App holt sich bei jedem Öffnen eine frische Sitzung. Das ist
-- richtig — der alte Token wird dabei aber nur weggeworfen, nicht gelöscht.
-- Nach ein paar Wochen standen auf einem Konto 304 Sitzungen bei 4 Geräten,
-- und die Liste der verbundenen Geräte wäre damit unlesbar gewesen.
--
-- Behalten wird je Trainer, Art und User-Agent die zuletzt gesehene: genau die,
-- die der jeweilige Client tatsächlich in der Hand hält. Die älteren Token hat
-- niemand mehr; sie wären ohnehin binnen 24 Stunden verfallen.
DELETE FROM sessions WHERE token_hash NOT IN (
  SELECT token_hash FROM (
    SELECT token_hash,
           ROW_NUMBER() OVER (
             PARTITION BY trainer_id, kind, user_agent ORDER BY last_seen_at DESC, issued_at DESC
           ) AS rang
    FROM sessions
  ) WHERE rang = 1
);
