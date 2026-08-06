import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import App from './App.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('memory-panel-root')).render(
  <React.StrictMode>
    <ClerkProvider afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </React.StrictMode>
)
