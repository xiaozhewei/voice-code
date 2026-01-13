#!/usr/bin/env node

const express = require('express');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const QRCode = require('qrcode');
const os = require('os');
const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 3000);

/** @type {string | null} */
let publicTunnelUrl = null;
/** @type {any | null} */
let ngrokListener = null;

function hasArg(flag) {
  return process.argv.includes(flag);
}

function tunnelEnabled() {
  return hasArg('--tunnel') || hasArg('--ngrok') || hasArg('-t');
}

function getAutoStartCommand() {
  if (hasArg('--gemini') || hasArg('-g')) return 'gemini';
  if (hasArg('--claude') || hasArg('-c')) return 'claude';
  return null;
}

function ngrokAuthtokenPresent() {
  return Boolean(process.env.NGROK_AUTHTOKEN && String(process.env.NGROK_AUTHTOKEN).trim());
}

function killNgrokProcessBestEffort() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32'
      ? 'taskkill /F /IM ngrok.exe /T'
      : 'pkill ngrok';
    exec(cmd, () => resolve());
  });
}

const app = express();

// --- Asset Manifest (hash table) ---
// Generated once on server startup and served to clients for cache-busting.
function buildAssetsManifest() {
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) return;
  const entries = fs.readdirSync(publicDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort();

  /** @type {Record<string, string>} */
  const manifest = {};
  for (const name of files) {
    try {
      const buf = fs.readFileSync(path.join(publicDir, name));
      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      manifest[`/${name}`] = hash;
    } catch {
      // ignore individual read/hash failures
    }
  }

  // Deterministic overall hash so clients can compare quickly.
  const overall = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
  manifest.__hash = overall;
  manifest.__generatedAt = new Date().toISOString();

  try {
    fs.writeFileSync(
      path.join(publicDir, 'assets-manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
  } catch {
    // ignore write failures
  }
}

try {
  buildAssetsManifest();
} catch {
  // ignore manifest failures; app still works without it.
}

// Load certificates for HTTPS
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// Static app
app.use('/', express.static(path.join(__dirname, 'public')));
app.use('/themes', express.static(path.join(__dirname, 'theme')));

// API to generate QR Code
app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(text);
    res.json({ dataUrl });
  } catch (err) {
    console.error('QR Code generation failed:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// API to get server info (LAN IP and Port)
app.get('/api/info', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    port: PORT,
    tunnelUrl: publicTunnelUrl
  });
});

// API to list themes
app.get('/api/themes', (req, res) => {
  const themeDir = path.join(__dirname, 'theme');
  fs.readdir(themeDir, (err, files) => {
    if (err) {
      console.error('Failed to read theme directory:', err);
      return res.status(500).json({ error: 'Failed to list themes' });
    }
    const themes = files
      .filter(file => file.endsWith('.json'))
      .map(file => path.basename(file, '.json'));
    res.json(themes);
  });
});

// Serve browser bundles from node_modules
// (xterm is served via CDN now)

// Create HTTPS Server
const server = https.createServer(sslOptions, app);

// Serve index.html for session IDs
app.get('/:id', (req, res, next) => {
  if (req.params.id.includes('.')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * @typedef {Object} TerminalSession
 * @property {import('node-pty').IPty} ptyProcess
 * @property {Set<WebSocket>} sockets
 * @property {Set<WebSocket>} controlSockets
 * @property {string} history
 */

/** @type {Map<string, TerminalSession>}*/
const sessions = new Map();

function newSessionId() {
  let id = 1;
  while (sessions.has(String(id))) {
    id++;
  }
  return String(id);
}

function defaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || 'bash';
}

function defaultCwd() {
  return process.cwd();
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const wssTerm = new WebSocket.Server({ noServer: true });
const wssCtl = new WebSocket.Server({ noServer: true });

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function scheduleSessionTimeout(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  // Only schedule if no clients are connected
  if (session.sockets.size === 0 && session.controlSockets.size === 0) {
    // Clear existing timeout if any
    if (session.timeoutId) clearTimeout(session.timeoutId);
    
    session.timeoutId = setTimeout(() => {
      const s = sessions.get(sessionId);
      if (s) {
        s.ptyProcess.kill();
        sessions.delete(sessionId);
      }
    }, SESSION_TIMEOUT);
  }
}

function cancelSessionTimeout(session) {
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }
}

wssTerm.on('connection', (ws, req) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  let sessionId = url.searchParams.get('sessionId');

  // Setup heartbeat for this connection
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const attachToSession = (sessId) => {
    const session = sessions.get(sessId);
    if (!session) return false;

    cancelSessionTimeout(session);

    // Notify control sockets that a new terminal joined (likely from QR scan)
    const joinMsg = JSON.stringify({ type: 'session_joined' });
    for (const controlWs of session.controlSockets) {
      if (controlWs.readyState === WebSocket.OPEN) {
        controlWs.send(joinMsg);
      }
    }

    session.sockets.add(ws);
    if (session.history) ws.send(session.history);
    
    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const msg = safeParseJson(text);
      
      if (msg && msg.type === 'hello') {
          // 1. Adopt the new client's size IMMEDIATELY, before sending ready.
          // This ensures the client receives the *confirmed* new size, not the old one.
          if (msg.cols && msg.rows) {
            try {
              session.ptyProcess.resize(Number(msg.cols), Number(msg.rows));
              
              // Broadcast resize to other clients (e.g. Desktop) so they sync up
              const resizeMsg = JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows });
              for (const cSocket of session.controlSockets) {
                if (cSocket.readyState === WebSocket.OPEN) {
                  cSocket.send(resizeMsg);
                }
              }
            } catch (err) {
              console.error('Failed to resize PTY on join:', err);
            }
          }

          // 2. Send ready with the NOW UPDATED dimensions
          ws.send(JSON.stringify({ 
            type: 'ready', 
            sessionId: sessId,
            cols: session.ptyProcess.cols,
            rows: session.ptyProcess.rows
          }));
          return;
      }
      session.ptyProcess.write(text);
    });

    ws.on('close', () => { 
      session.sockets.delete(ws); 
      scheduleSessionTimeout(sessId);
    });
    return true;
  };

  if (sessionId && sessions.has(sessionId)) {
    attachToSession(sessionId);
    return;
  }

  ws.on('message', (data) => {
    if (sessions.has(sessionId) && sessions.get(sessionId).sockets.has(ws)) {
      const session = sessions.get(sessionId);
      const text = typeof data === 'string' ? data : data.toString('utf8');
      session.ptyProcess.write(text);
      return;
    }

    const text = typeof data === 'string' ? data : data.toString('utf8');
    const msg = safeParseJson(text);
    if (!msg || msg.type !== 'hello') return;

        const cols = Number(msg.cols || 80);
        const rows = Number(msg.rows || 24);
    
        if (!sessionId) sessionId = newSessionId();
    
        const ptyProcess = pty.spawn(defaultShell(), [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: defaultCwd(),
          env: process.env,
        });
    
            const autoStartCmd = getAutoStartCommand();
            if (autoStartCmd) {
              setTimeout(() => {
                if (sessions.has(sessionId)) {
                  ptyProcess.write(`${autoStartCmd}\r`);
                }
              }, 1500);
            }    
        const session = { 
          ptyProcess, 
          sockets: new Set([ws]), 
          controlSockets: new Set(),
          history: '',
          quickActions: null, // In-memory cache for this session
          timeoutId: null
        };
        sessions.set(sessionId, session);
    
        ptyProcess.onData((chunk) => {
          session.history += chunk;
          if (session.history.length > 100000) {
            session.history = session.history.slice(-100000);
          }
          for (const socket of session.sockets) {
            if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
          }
        });
    
        ptyProcess.onExit(() => {
          if (session.timeoutId) clearTimeout(session.timeoutId);
          sessions.delete(sessionId);
          for (const socket of session.sockets) {
            if (socket.readyState === WebSocket.OPEN) socket.close();
          }
        });
    
        ws.send(JSON.stringify({ type: 'ready', sessionId }));
    
        ws.on('close', () => {
        const currentSession = sessions.get(sessionId);
        if (currentSession) {
            currentSession.sockets.delete(ws);
            scheduleSessionTimeout(sessionId);
        }
    });
  });
});

wssCtl.on('connection', (ws, request) => {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  
  // Setup heartbeat for control socket
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  if (!sessionId) {
    ws.close();
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    ws.close();
    return;
  }

  cancelSessionTimeout(session);
  session.controlSockets.add(ws);
  
  // If session already has data, sync it to the new client immediately
  if (session.quickActions) {
    ws.send(JSON.stringify({ type: 'history_update', commands: session.quickActions }));
  }

  ws.on('close', () => {
    session.controlSockets.delete(ws);
    scheduleSessionTimeout(sessionId);
  });

  ws.on('message', (data) => {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    const msg = safeParseJson(text);
    if (!msg) return;

    const normalizeQuickActionValue = (value) => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const candidate = value.cmd ?? value.command ?? value.text ?? value.label ?? value.value;
        if (typeof candidate === 'string') return candidate;
      }
      if (value == null) return '';
      return String(value);
    };

    const normalizeQuickActions = (commands) => {
      if (!Array.isArray(commands)) return [];
      return commands
        .map(normalizeQuickActionValue)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    };

    if (msg.type === 'resize') {
      try { 
        session.ptyProcess.resize(Number(msg.cols), Number(msg.rows));
        // Broadcast resize to other clients (e.g., mobile observers)
        const resizeMsg = JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows });
        for (const cSocket of session.controlSockets) {
          if (cSocket !== ws && cSocket.readyState === WebSocket.OPEN) {
            cSocket.send(resizeMsg);
          }
        }
      } catch {}
    } else if (msg.type === 'client_commands_push') {
      // Client is sharing its local storage state on connect
      if (!session.quickActions && Array.isArray(msg.commands)) {
        // Server was empty, adopt client's data
        session.quickActions = normalizeQuickActions(msg.commands);
        // Broadcast this adoption to everyone (to sync other potential clients)
        const updateMsg = JSON.stringify({ type: 'history_update', commands: session.quickActions });
        for (const cSocket of session.controlSockets) {
            if (cSocket.readyState === WebSocket.OPEN) cSocket.send(updateMsg);
        }
      } else if (session.quickActions) {
        // Server already has data (master authority), overwrite the client's stale data
        ws.send(JSON.stringify({ type: 'history_update', commands: session.quickActions }));
      }
    } else if (msg.type === 'update_quick_actions') {
      if (Array.isArray(msg.commands)) {
        // User manually edited commands, update session and broadcast
        session.quickActions = normalizeQuickActions(msg.commands);
        
        const updateMsg = JSON.stringify({ type: 'history_update', commands: session.quickActions });
        for (const cSocket of session.controlSockets) {
            if (cSocket.readyState === WebSocket.OPEN) {
              cSocket.send(updateMsg);
            }
        }
      }
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `https://${request.headers.host}`);
  if (url.pathname === '/ws') {
    wssTerm.handleUpgrade(request, socket, head, (ws) => wssTerm.emit('connection', ws, request));
  } else if (url.pathname === '/ctl') {
    wssCtl.handleUpgrade(request, socket, head, (ws) => wssCtl.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

// Server-side heartbeat: ping all terminal connections periodically
const heartbeatInterval = setInterval(() => {
  wssTerm.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping(); // Send WebSocket ping frame
  });
  
  // Also ping control sockets
  wssCtl.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// Clean up on server close
server.on('close', () => {
  clearInterval(heartbeatInterval);
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

if (require.main === module) {
  server.listen(PORT, async () => {
    const localIp = getLocalIp();

    if (tunnelEnabled()) {
      try {
        // Best effort: avoid stale ngrok binary instances holding resources.
        await killNgrokProcessBestEffort();

        // Use official ngrok JS SDK.
        // NOTE: Our local server is HTTPS with a self-signed cert, so disable upstream TLS verification.
        const ngrok = require('@ngrok/ngrok');
        ngrokListener = await ngrok.forward({
          addr: `https://127.0.0.1:${PORT}`,
          authtoken_from_env: true,
          verify_upstream_tls: false,
        });
        publicTunnelUrl = (ngrokListener && typeof ngrokListener.url === 'function') ? ngrokListener.url() : null;
      } catch (err) {
        publicTunnelUrl = null;
        const msg = (err && err.message) ? err.message : String(err);
        console.error(chalk.red('  Failed to start ngrok tunnel:'));
        console.error(chalk.red(`  ${msg}`));
      }
    }

    const localUrl = `https://localhost:${PORT}`;

    // Auto-open browser
    const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${startCmd} ${localUrl}`);

    const message =
      gradient.pastel.multiline('  VoiceCode v1.0  ') + '\n\n' +
      chalk.bold.white('  🚀 Server is running (HTTPS)!') + '\n\n' +
      chalk.green('  ➜  Local:   ') + chalk.cyan.underline(`https://localhost:${PORT}`) + '\n' +
      chalk.green('  ➜  Network: ') + chalk.cyan.underline(`https://${localIp}:${PORT}`) +
      (publicTunnelUrl ? '\n' + chalk.magenta('  ➜  Tunnel:  ') + chalk.cyan.underline(publicTunnelUrl) : '') + '\n' +
      chalk.gray('  ➜  Shell:   ') + chalk.yellow(defaultShell()) +
      (getAutoStartCommand() ? '\n' + chalk.gray('  ➜  Auto:    ') + chalk.magenta(getAutoStartCommand()) : '') + '\n\n' +
      chalk.yellow.dim('  Note: Accept the self-signed certificate warning in your browser.');

    console.log(boxen(message, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
      backgroundColor: '#282a36'
    }));
  });

  const cleanup = async () => {
    try {
      if (ngrokListener && typeof ngrokListener.close === 'function') {
        await ngrokListener.close();
      } else {
        try {
          const ngrok = require('@ngrok/ngrok');
          await ngrok.disconnect();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

module.exports = app;
