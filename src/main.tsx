import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DialogsProvider } from './components/Dialogs'
import './styles.css'
import './mobile.css'
import './call-layout.css'
import './community.css'
import './audio-settings.css'

// Retire the previous notification worker and close any notices it left behind.
if ('serviceWorker' in navigator) {
  const retiredScript = new URL(`${import.meta.env.BASE_URL}notifications-sw.js`, window.location.origin).href
  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    for (const registration of registrations) {
      if (![registration.active, registration.waiting, registration.installing].some((worker) => worker?.scriptURL === retiredScript)) continue
      const notifications = await registration.getNotifications().catch(() => [])
      notifications.forEach((notification) => notification.close())
      await registration.unregister()
    }
  }).catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DialogsProvider>
      <App />
    </DialogsProvider>
  </React.StrictMode>,
)
