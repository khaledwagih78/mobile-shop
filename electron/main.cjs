const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');

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
