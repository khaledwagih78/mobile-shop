import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAutoSync } from './sync';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Start cloud sync after React mounts
startAutoSync();
