const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell, app, safeStorage } = require('electron');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = require('./oauth-config');

function tokenFilePath() {
    return path.join(app.getPath('userData'), 'google-refresh.token');
}

function saveRefreshToken(token) {
    try {
        const data = safeStorage.isEncryptionAvailable()
            ? safeStorage.encryptString(token)
            : Buffer.from(token, 'utf8');
        fs.writeFileSync(tokenFilePath(), data);
    } catch (e) {
        console.error('Impossible de sauvegarder le refresh token :', e);
    }
}

function loadRefreshToken() {
    try {
        const data = fs.readFileSync(tokenFilePath());
        return safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(data)
            : data.toString('utf8');
    } catch (e) {
        return null;
    }
}

function clearRefreshToken() {
    try { fs.unlinkSync(tokenFilePath()); } catch (e) { /* déjà absent */ }
}

async function exchangeRefreshToken(refreshToken) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data;
}

async function silentSignIn() {
    const refreshToken = loadRefreshToken();
    if (!refreshToken) return null;
    try {
        const data = await exchangeRefreshToken(refreshToken);
        return { idToken: data.id_token };
    } catch (e) {
        clearRefreshToken();
        return null;
    }
}

function googleSignIn() {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            fn(value);
        };

        const expectedState = crypto.randomBytes(16).toString('hex');
        let port;
        let handled = false;

        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const state = url.searchParams.get('state');

            // Le navigateur redemande souvent des ressources parasites (favicon.ico...)
            // sur ce serveur juste apres la vraie redirection : on les ignore sans
            // jamais les traiter comme une tentative de connexion invalide.
            if (!code && !error) {
                res.writeHead(204);
                res.end();
                return;
            }
            if (handled) {
                res.writeHead(204);
                res.end();
                return;
            }
            handled = true;

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

            if (error) {
                res.end('<h1>Connexion annulée</h1><p>Tu peux fermer cette page.</p>');
                server.close();
                return done(reject, new Error(error));
            }
            if (!code || state !== expectedState) {
                res.end('<h1>Requête invalide</h1><p>Tu peux fermer cette page.</p>');
                server.close();
                return done(reject, new Error('invalid_request'));
            }

            res.end('<h1>Connexion réussie ✅</h1><p>Tu peux fermer cette page et revenir sur SDW Launcher.</p>');
            server.close();

            fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: `http://127.0.0.1:${port}`,
                    grant_type: 'authorization_code'
                })
            })
                .then(r => r.json())
                .then(tokenData => {
                    if (tokenData.error) {
                        return done(reject, new Error(tokenData.error_description || tokenData.error));
                    }
                    if (tokenData.refresh_token) {
                        saveRefreshToken(tokenData.refresh_token);
                    }
                    done(resolve, { idToken: tokenData.id_token });
                })
                .catch(e => done(reject, e));
        });

        server.listen(0, '127.0.0.1', () => {
            port = server.address().port;
            const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                redirect_uri: `http://127.0.0.1:${port}`,
                response_type: 'code',
                scope: 'openid email profile',
                access_type: 'offline',
                prompt: 'consent',
                state: expectedState
            });
            shell.openExternal(authUrl);
        });

        server.on('error', (e) => done(reject, e));

        const timeout = setTimeout(() => {
            server.close();
            done(reject, new Error('timeout'));
        }, 120000);
    });
}

function signOutGoogle() {
    clearRefreshToken();
}

module.exports = { googleSignIn, silentSignIn, signOutGoogle };
