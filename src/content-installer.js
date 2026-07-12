const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const _7z = require('7zip-min');
const { createExtractorFromFile } = require('node-unrar-js');
const { File } = require('megajs');
const { app, dialog } = require('electron');

const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z'];

// 7zip-min tente de détecter automatiquement s'il tourne dans un app.asar
// en inspectant process.argv, mais cette détection ne fonctionne pas avec
// notre façon de lancer l'app. On force nous-mêmes le bon chemin vers le
// binaire 7za extrait de l'asar (voir asar.unpack dans forge.config.js).
if (app.isPackaged) {
    const { path7za } = require('7zip-bin');
    _7z.config({ binaryPath: path7za.replace('app.asar', 'app.asar.unpacked') });
}

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

function isArchive(name) {
    const ext = path.extname(name || '').toLowerCase();
    return ARCHIVE_EXTENSIONS.includes(ext);
}

async function extractArchive(archivePath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(archivePath).toLowerCase();

    if (ext === '.zip') {
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(destDir, true);
        return;
    }
    if (ext === '.7z') {
        await new Promise((resolve, reject) => {
            _7z.unpack(archivePath, destDir, (err) => err ? reject(err) : resolve());
        });
        return;
    }
    if (ext === '.rar') {
        const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: destDir });
        const extracted = extractor.extract({});
        // Le générateur doit être parcouru pour que l'extraction s'exécute réellement.
        [...extracted.files];
        return;
    }
    throw new Error(`Format d'archive non pris en charge : ${ext}`);
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
        } else if (isArchive(child.name)) {
            // Chaque élément est distribué sous forme d'une archive individuelle :
            // on la télécharge à part puis on l'extrait directement dans content/cars (ou tracks).
            const tmpFilePath = path.join(tmpDir, child.name);
            await downloadMegaFileToPath(child, tmpFilePath, onProgress);
            await extractArchive(tmpFilePath, destDir);
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
            if (!root.children || !root.children.length) {
                throw new Error('Ce dossier Mega est vide, rien à installer.');
            }
            // Lien de dossier Mega : le contenu va directement dans content/cars (ou tracks)
            await downloadMegaFolderRecursive(root, destContentDir, tmpDir, onProgress);
        } else {
            const tmpFilePath = path.join(tmpDir, root.name || 'download');
            await downloadMegaFileToPath(root, tmpFilePath, onProgress);

            if (isArchive(tmpFilePath)) {
                await extractArchive(tmpFilePath, destContentDir);
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
