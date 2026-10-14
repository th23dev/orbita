import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DialogsProvider } from './components/Dialogs'
import './styles.css'
import './mobile.css'
import './call-layout.css'
import './community.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DialogsProvider>
      <App />
    </DialogsProvider>
  </React.StrictMode>,
)
