const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// --- Auto-update (installed app only): checks GitHub Releases, downloads in the
// background, and offers a restart to install. The repo is public, so no token
// is needed on the client. The portable build can't self-update — only the
// installer (nsis) target does. ---
function setupAutoUpdates() {
  if (!app.isPackaged) return; // skip during `electron:start` / dev
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['إعادة التشغيل الآن', 'لاحقاً'],
      defaultId: 0,
      cancelId: 1,
      title: 'تحديث جديد جاهز',
      message: `تم تنزيل تحديث جديد${info && info.version ? ` (الإصدار ${info.version})` : ''}.`,
      detail: 'سيتم تثبيت التحديث عند إعادة تشغيل البرنامج.',
      noLink: true,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => console.warn('[updater]', (err && err.message) || err));

  autoUpdater.checkForUpdatesAndNotify().catch((e) => console.warn('[updater] check failed:', e && e.message));
  // re-check every 4 hours while the app stays open
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;

// Isolate and persist data in dedicated AppData directory
app.setName('ERP System');
const customUserData = path.join(app.getPath('appData'), 'khaled-erp-pro');
app.setPath('userData', customUserData);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 840,
    minWidth: 1024,
    minHeight: 640,
    title: 'نظام إدارة الأعمال المتكامل',
    backgroundColor: '#f2f5f6',
    icon: path.join(__dirname, '../public/icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Hide default menu bar, but allow Alt key to show if needed or full removal
  Menu.setApplicationMenu(null);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Second instance focus handler
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  // IPC Handlers
  ipcMain.handle('app:get-version', () => app.getVersion());

  // Manual "check for updates" trigger (optional UI button can call this)
  ipcMain.handle('app:check-updates', () => (app.isPackaged ? autoUpdater.checkForUpdates().catch(() => null) : null));

  ipcMain.handle('app:open-external', async (_, url) => {
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('app:print', async (_, options = {}) => {
    if (!mainWindow) return false;
    return new Promise((resolve) => {
      mainWindow.webContents.print(
        {
          silent: options.silent || false,
          printBackground: true,
          deviceName: options.deviceName || '',
        },
        (success, failureReason) => {
          if (!success) console.warn('[electron:print] failed:', failureReason);
          resolve(success);
        }
      );
    });
  });

  createWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
