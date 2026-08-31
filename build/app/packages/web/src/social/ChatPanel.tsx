import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type ChatView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction } from '../lib/useAsync'
import { CenterState } from '../ui/States'

/** Wie oft nachgesehen wird, solange der Chat offen ist. */
const POLL_MS = 8_000

/**
 * Globaler Chat.
 *
 * Ein Raum für den ganzen Verbund. Ohne Verbund gibt es ihn nicht — dann steht
 * hier eine Erklärung statt eines leeren Fensters.
 *
 * Nachgesehen wird, solange die Seite offen ist, und nur dann: ein Chat, der
 * im Hintergrund weiterfragt, ist ein Chat, der Akku frisst.
 */
export function ChatPanel() {
  const [view, setView] = useState<ChatView | null>(null)
  const [text, setText] = useState('')
  const action = useAction()
  const ende = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let laeuft = true
    const holen = () => { void api.chat().then((v) => { if (laeuft) setView(v) }).catch(() => {}) }
    holen()
    const timer = setInterval(holen, POLL_MS)
    return () => { laeuft = false; clearInterval(timer) }
  }, [])

  // Ans Ende scrollen, wenn etwas dazukommt — aber im eigenen Kasten, nicht
  // die ganze Seite.
  useEffect(() => {
    ende.current?.scrollIntoView({ block: 'nearest' })
  }, [view?.messages.length])

  const senden = () => {
    const gesagt = text.trim()
    if (gesagt === '') return
    haptic.tap()
    void action.run(() => api.sendChat(gesagt), (v) => { setView(v); setText('') })
  }

  if (view && !view.enabled) {
    return <CenterState glyph="💬" title={t('chat.title')} body={t('chat.noHub')} />
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      <div className="chat" role="log" aria-live="polite">
        {view?.messages.length === 0
          ? <p className="center__body">{t('chat.empty')}</p>
          : view?.messages.map((m) => (
              <div key={m.id} className={`chat__row${m.isSelf ? ' chat__row--self' : ''}`}>
                <span className="chat__head">
                  <span className="chat__name">{m.name}</span>
                  <span className="chat__where">{m.instanceId}</span>
                </span>
                <span className="chat__body">{m.body}</span>
              </div>
            ))}
        <div ref={ende} />
      </div>

      <form
        className="chat__form"
        onSubmit={(e) => { e.preventDefault(); senden() }}
      >
        <input
          className="chat__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={400}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
        />
        <button type="submit" className="btn btn--primary btn--sm"
          disabled={action.busy || text.trim() === ''}>
          {t('chat.send')}
        </button>
      </form>
    </>
  )
}
