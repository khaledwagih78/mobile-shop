import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAutoSync } from './sync';
import { requestNotificationPermission } from './db';
import { maybeSendPeriodicReports } from './periodicReports';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Start cloud sync after React mounts
startAutoSync();

// Request notification permission for low stock alerts
requestNotificationPermission();

// Send any due periodic email reports (best-effort, only while the app is open)
setTimeout(maybeSendPeriodicReports, 6000);
setInterval(maybeSendPeriodicReports, 3 * 60 * 60 * 1000); // re-check every 3h
