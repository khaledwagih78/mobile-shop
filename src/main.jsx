import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAutoSync } from './sync';
import { getSetting } from './db';
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

// Drop expired/invalid licenses back to the free plan (best-effort)
enforceLicenseOnBoot(getSetting);

// Send any due periodic email reports (best-effort, only while the app is open)
setTimeout(maybeSendPeriodicReports, 6000);
setInterval(maybeSendPeriodicReports, 3 * 60 * 60 * 1000); // re-check every 3h

// Opt-in automatic backup on open: if enabled and overdue, download a fresh copy.
// Best-effort — browsers may block a programmatic download without a user gesture.
setTimeout(async () => {
  try {
    if (!(await getSetting('autoBackup', false))) return;
    const days = Number(await getSetting('backupReminderDays', 7)) || 7;
    const last = await getSetting('lastBackupAt', null);
    const overdue = !last || (Date.now() - new Date(last).getTime()) > days * 86400000;
    if (!overdue) return;
    const { exportBackup } = await import('./backup');
    await exportBackup(null); // unencrypted auto-copy; also stamps lastBackupAt
  } catch { /* ignore — reminder banner still nudges the user */ }
}, 8000);
