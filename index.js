const { app, BrowserWindow, ipcMain, shell, Menu, dialog, autoUpdater } = require('electron');
const path = require('path');
const { googleSignIn, silentSignIn, signOutGoogle } = require('./src/google-auth');
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
const { installFromMega } = require('./src/content-installer');

if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow;

Menu.setApplicationMenu(null);

if (app.isPackaged) {
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'lupixoffi-cmd/SDW-Launcher'
    },
    updateInterval: '5 minutes',
    notifyUser: true,
    onNotifyUser: () => {
      if (mainWindow) mainWindow.webContents.send('show-update-modal');
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0b0b10',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Tout lien externe (target="_blank", window.open, y compris depuis les iframes)
  // doit s'ouvrir avec le systeme (navigateur, Discord, Spotify...) et jamais
  // dans une fenetre de l'appli.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile('index.html');
}

ipcMain.handle('choose-install-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choisis le dossier d'installation (content/cars ou content/tracks)",
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('install-content', async (event, { url, contentType, destDir }) => {
  try {
    const finalDir = await installFromMega({
      url,
      contentType,
      destDir,
      mainWindow,
      onProgress: (fraction) => {
        event.sender.send('install-progress', { fraction });
      }
    });
    return { success: true, path: finalDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.on('update-restart-now', () => autoUpdater.quitAndInstall());

ipcMain.handle('google-signin', () => googleSignIn());
ipcMain.handle('google-silent-signin', () => silentSignIn());
ipcMain.handle('google-signout', () => signOutGoogle());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});