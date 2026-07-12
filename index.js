const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { googleSignIn, silentSignIn, signOutGoogle } = require('./src/google-auth');
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');

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
    updateInterval: '5 minutes'
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

// Gestion des téléchargements
ipcMain.on('download-content', async (event, data) => {
  const savePath = path.join(app.getPath('downloads'), `${data.type}.zip`);
  const status = (msg) => mainWindow.webContents.send('download-status', msg);

  status('⬇️ Téléchargement lancé...');

  try {
    const response = await axios({
      method: 'get',
      url: data.url,
      responseType: 'stream',
      timeout: 0 // Pas de timeout
    });

    const writer = fs.createWriteStream(savePath);
    response.data.pipe(writer);

    writer.on('finish', () => {
      status('📦 Extraction...');
      try {
        const zip = new AdmZip(savePath);
        const acPath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa\\content';
        zip.extractAllTo(acPath, true);
        status(`✅ ${data.type} installé avec succès !`);
      } catch (e) {
        status('❌ Erreur extraction. Vérifie que le dossier content existe.');
      }
    });
  } catch (error) {
    status('❌ Erreur : ' + error.message);
  }
});

ipcMain.handle('google-signin', () => googleSignIn());
ipcMain.handle('google-silent-signin', () => silentSignIn());
ipcMain.handle('google-signout', () => signOutGoogle());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});