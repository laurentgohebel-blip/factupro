import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './lib/auth'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js')
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      w.addEventListener('statechange', () => {
        if (w.state === 'activated') window.location.reload()
      })
    })
  })
}