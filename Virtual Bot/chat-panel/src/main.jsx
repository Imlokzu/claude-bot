import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('chat-panel-root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
