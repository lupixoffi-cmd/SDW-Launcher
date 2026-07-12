const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const { googleSignIn, silentSignIn, signOutGoogle } = require('./src/google-auth');
const { updateElectronApp, UpdateSourceType, makeUserNotifier } = require('update-electron-app');
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
    onNotifyUser: makeUserNotifier({
      title: 'Mise à jour disponible',
      detail: 'Une nouvelle version de SDW Launcher a été téléchargée. Redémarre l\'application pour l\'appliquer.',
      restartButtonText: 'Redémarrer',
      laterButtonText: 'Plus tard'
    })
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

  mainWindow.loadFile('index.html');
}

ipcMain.handle('install-content', async (event, { url, contentType }) => {
  try {
    const destDir = await installFromMega({
      url,
      contentType,
      mainWindow,
      onProgress: (fraction) => {
        event.sender.send('install-progress', { fraction });
      }
    });
    return { success: true, path: destDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('google-signin', () => googleSignIn());
ipcMain.handle('google-silent-signin', () => silentSignIn());
ipcMain.handle('google-signout', () => signOutGoogle());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});