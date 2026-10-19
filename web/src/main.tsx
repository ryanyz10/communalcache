import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startInstallTracking } from './lib/install'

// Retain Android's one-shot event even if it arrives before sign-in finishes.
startInstallTracking()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
