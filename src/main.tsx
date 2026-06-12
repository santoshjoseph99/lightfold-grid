import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Create persistent off-screen container for cached terminal DOM elements
const offscreenContainer = document.createElement('div');
offscreenContainer.id = 'offscreen-terminal-cache';
document.body.appendChild(offscreenContainer);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
