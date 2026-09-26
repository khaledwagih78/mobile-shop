import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAutoSync } from './sync';
import { requestNotificationPermission, getSetting } from './db';
import { maybeSendPeriodicReports } from './periodicReports';
import { enforceLicenseOnBoot } from './license';
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

// Drop expired/invalid licenses back to the free plan (best-effort)
enforceLicenseOnBoot(getSetting);

// Send any due periodic email reports (best-effort, only while the app is open)
setTimeout(maybeSendPeriodicReports, 6000);
setInterval(maybeSendPeriodicReports, 3 * 60 * 60 * 1000); // re-check every 3h
