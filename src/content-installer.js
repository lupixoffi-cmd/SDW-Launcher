const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { File } = require('megajs');
const { app, dialog } = require('electron');

function configFilePath() {
    return path.join(app.getPath('userData'), 'ac-path.json');
}

function loadSavedAcPath() {
    try {
        const data = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'));
        return data.acPath;
    } catch (e) {
        return null;
    }
}

function saveAcPath(acPath) {
    try {
        fs.writeFileSync(configFilePath(), JSON.stringify({ acPath }));
    } catch (e) {
        console.error('Impossible de sauvegarder le chemin Assetto Corsa :', e);
    }
}

function findAssettoCorsaPath() {
    const saved = loadSavedAcPath();
    if (saved && fs.existsSync(saved)) return saved;

    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';

    const candidates = [
        path.join(programFilesX86, 'Steam', 'steamapps', 'common', 'assettocorsa'),
        path.join(programFiles, 'Steam', 'steamapps', 'common', 'assettocorsa')
    ];

    for (const letter of ['C', 'D', 'E', 'F', 'G', 'H']) {
        candidates.push(`${letter}:\\SteamLibrary\\steamapps\\common\\assettocorsa`);
        candidates.push(`${letter}:\\Steam\\steamapps\\common\\assettocorsa`);
        candidates.push(`${letter}:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa`);
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            saveAcPath(candidate);
            return candidate;
        }
    }
    return null;
}

async function askUserForAcPath(mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Sélectionne le dossier d'installation d'Assetto Corsa",
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    const chosen = result.filePaths[0];
    saveAcPath(chosen);
    return chosen;
}

function downloadMegaFileToPath(file, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const stream = file.download({});
        let downloaded = 0;
        stream.on('data', (chunk) => {
            downloaded += chunk.length;
            if (onProgress && file.size) onProgress(downloaded / file.size);
        });
        const writer = fs.createWriteStream(destPath);
        stream.pipe(writer);
        stream.on('error', reject);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function downloadMegaFolderRecursive(folder, destDir, tmpDir, onProgress) {
    fs.mkdirSync(destDir, { recursive: true });
    const children = folder.children || [];
    for (const child of children) {
        if (child.directory) {
            await downloadMegaFolderRecursive(child, path.join(destDir, child.name), tmpDir, onProgress);
        } else if (child.name && child.name.toLowerCase().endsWith('.zip')) {
            // Chaque voiture est distribuée sous forme d'un zip individuel :
            // on le télécharge à part puis on l'extrait directement dans content/cars (ou tracks).
            const tmpFilePath = path.join(tmpDir, child.name);
            await downloadMegaFileToPath(child, tmpFilePath, onProgress);
            const zip = new AdmZip(tmpFilePath);
            zip.extractAllTo(destDir, true);
        } else {
            await downloadMegaFileToPath(child, path.join(destDir, child.name), onProgress);
        }
    }
}

async function installFromMega({ url, contentType, mainWindow, onProgress }) {
    const acPath = findAssettoCorsaPath() || await askUserForAcPath(mainWindow);
    if (!acPath) {
        throw new Error("Dossier Assetto Corsa introuvable, installation annulée.");
    }

    const contentFolder = contentType === 'track' ? 'tracks' : 'cars';
    const destContentDir = path.join(acPath, 'content', contentFolder);
    fs.mkdirSync(destContentDir, { recursive: true });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdw-install-'));

    try {
        const root = File.fromURL(url);
        await root.loadAttributes();

        if (root.directory) {
            // Lien de dossier Mega : le contenu va directement dans content/cars (ou tracks)
            await downloadMegaFolderRecursive(root, destContentDir, tmpDir, onProgress);
        } else {
            const tmpFilePath = path.join(tmpDir, root.name || 'download.zip');
            await downloadMegaFileToPath(root, tmpFilePath, onProgress);

            if (tmpFilePath.toLowerCase().endsWith('.zip')) {
                const zip = new AdmZip(tmpFilePath);
                zip.extractAllTo(destContentDir, true);
            } else {
                fs.copyFileSync(tmpFilePath, path.join(destContentDir, root.name));
            }
        }
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    return destContentDir;
}

module.exports = { installFromMega, findAssettoCorsaPath };
