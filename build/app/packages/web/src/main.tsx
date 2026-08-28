import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ready } from './lib/telegram'
import './styles.css'

// Tell Telegram we are painted before React mounts, so the client stops its own
// loading indicator and hands over the full viewport.
ready()

const root = document.getElementById('root')
if (!root) throw new Error('#root fehlt in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
