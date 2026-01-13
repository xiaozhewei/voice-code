/* global Terminal, FitAddon, AttachAddon, WebLinksAddon, SearchAddon, WebglAddon */

const terminalEl = document.getElementById('terminal');

// --- Voice Model Status UI ---
const voiceModelStatusEl = document.getElementById('voice-model-status');
const setVoiceModelStatus = (text, err) => {
  if (!voiceModelStatusEl) return;
  if (!err) {
    voiceModelStatusEl.textContent = text;
    return;
  }
  const msg = (err && err.message) ? err.message : String(err);
  const short = msg.length > 80 ? msg.slice(0, 77) + '…' : msg;
  voiceModelStatusEl.textContent = `${text} (${short})`;
};
setVoiceModelStatus('Voice: Idle');

// 精心调配的 Dracula Pro 风格主题
const customTheme = {
  // 基础色
  background: '#22212c',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#22212c',
  selectionBackground: 'rgba(98, 114, 164, 0.4)',
  selectionForeground: '#f8f8f2',
  selectionInactiveBackground: 'rgba(98, 114, 164, 0.2)',

  // 标准 ANSI 颜色
  black: '#454158',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',

  // 高亮 ANSI 颜色
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorInactiveStyle: 'outline',
  convertEol: true,
  fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',
  fontSize: parseInt(localStorage.getItem('terminalFontSize')) || 14,
  fontWeight: '400',
  fontWeightBold: '600',
  lineHeight: 1.2,
  letterSpacing: 0,
  theme: customTheme,
  allowTransparency: true,
  scrollback: 10000,
  // 确保 Reflow 功能启用（让前端自动处理换行）
  windowsMode: false, 
  // 优化渲染性能
  rendererType: 'canvas'
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);

// Interactive: clickable links + search
try {
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
} catch {
  // ignore
}



// Performance: WebGL renderer (optional, may fail on some environments)
try {
  term.loadAddon(new WebglAddon.WebglAddon());
} catch {
  // ignore
}

console.log('[Terminal] Initializing...');

// Ensure fonts are loaded before opening the terminal to prevent sizing/rendering issues
document.fonts.ready.then(() => {
  console.log('[Terminal] Fonts ready');
  term.open(terminalEl);
  fitAddon.fit();
  term.focus();
  
  // Re-fit on window load just in case layout shifts
  window.addEventListener('load', () => fitAddon.fit());
});

// Extract session ID from URL (e.g., /123)
let urlSessionId = location.pathname.slice(1); // Remove leading slash
if (urlSessionId === 'index.html') urlSessionId = '';

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';

// --- Session State Variables (must be declared before WebSocket code) ---
let sessionId = null;
let attached = false;
let pendingOutput = [];
const statusDot = document.getElementById('status-dot');

function updateStatus(status) {
  if (statusDot) statusDot.className = 'status-indicator ' + status;
}

function decodeMessageData(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return '';
}

function requestHello() {
  fitAddon.fit();
  if (wsTerm && wsTerm.readyState === WebSocket.OPEN) {
    wsTerm.send(
      JSON.stringify({
        type: 'hello',
        cols: term.cols,
        rows: term.rows,
      })
    );
  }
}

// --- WebSocket Connection Management with Auto-Reconnect & Heartbeat ---
let wsTerm = null;
let wsTermReconnectAttempts = 0;
const WS_MAX_RECONNECT_ATTEMPTS = 10;
const WS_RECONNECT_BASE_DELAY = 1000; // Start with 1 second

function getTermWsUrl() {
  return `${proto}//${location.host}/ws${sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : (urlSessionId ? '?sessionId=' + encodeURIComponent(urlSessionId) : '')}`;
}

// Global input handler to pipe terminal data to WebSocket
term.onData((data) => {
  if (wsTerm && wsTerm.readyState === WebSocket.OPEN) {
    wsTerm.send(data);
  }
});

function createTerminalWebSocket() {
  const wsUrl = getTermWsUrl();
  console.log('[WebSocket] Connecting to:', wsUrl);
  
  wsTerm = new WebSocket(wsUrl);
  wsTerm.binaryType = 'arraybuffer';
  
  wsTerm.addEventListener('open', handleWsOpen);
  wsTerm.addEventListener('message', handleWsMessage);
  wsTerm.addEventListener('close', handleWsClose);
  wsTerm.addEventListener('error', handleWsError);
  
  return wsTerm;
}

function handleWsOpen() {
  console.log('[WebSocket] Connected');
  updateStatus('connected');
  wsTermReconnectAttempts = 0;
  requestHello();
}

function handleWsMessage(ev) {
  const text = decodeMessageData(ev.data);
  if (!text) return;

  try {
    const msg = JSON.parse(text);
    if (msg && msg.type === 'ready' && msg.sessionId) {
      sessionId = msg.sessionId;
      
      // Update URL to match session ID if different
      if (urlSessionId !== sessionId) {
        history.pushState({}, '', '/' + sessionId);
      }
      
      // Sync local terminal size to server PTY size immediately
      if (msg.cols && msg.rows) {
        console.log(`[Terminal] Syncing to server size: ${msg.cols}x${msg.rows}`);
        term.resize(msg.cols, msg.rows);
      }
      
      if (!attached) {
        attachTerminal();
      } else {
        // Reconnect path: just ensure resize control is active
        setupResizeControl();
        term.write('\r\n\x1b[32m[reconnected]\x1b[0m\r\n');
      }
      return;
    }
  } catch {
    // Not JSON; assume it's PTY output.
  }

  // Handle Smart Clear (CSI 2 J / 3 J)
  // Detect CSI 2 J (Clear Entire Screen) or CSI 3 J (Clear Scrollback) or RIS (Reset)
  if ((text.includes('\x1b[2J') || text.includes('\x1b[3J') || text.includes('\x1bc')) &&
      !text.includes('\x1b[?1049h') && !text.includes('\x1b[?47h')) {
    if (term.buffer.active.type === 'normal') {
      term.options.scrollback = 0;
      setTimeout(() => { term.options.scrollback = 10000; }, 1);
    }
  }

  if (attached) {
    term.write(text);
  } else {
    pendingOutput.push(text);
  }
}

function handleWsClose(ev) {
  console.log('[WebSocket] Disconnected, code:', ev.code, 'reason:', ev.reason);
  updateStatus('disconnected');
  attached = false; // Reset attached state to allow buffering on reconnect
  
  // Attempt to reconnect if we have a session
  if ((sessionId || urlSessionId) && wsTermReconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
    wsTermReconnectAttempts++;
    const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(1.5, wsTermReconnectAttempts - 1), 30000);
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${wsTermReconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS})...`);
    term.write(`\r\n\x1b[33m[reconnecting in ${Math.round(delay/1000)}s...]\x1b[0m`);
    
    setTimeout(() => {
      if (document.visibilityState !== 'hidden') {
        createTerminalWebSocket();
      }
    }, delay);
  } else if (!sessionId && !urlSessionId) {
    term.write('\r\n[disconnected]\r\n');
  } else {
    term.write('\r\n\x1b[31m[connection lost - please refresh]\x1b[0m\r\n');
  }
}

function handleWsError(err) {
  console.error('[WebSocket] Error:', err);
}

// Reconnect when page becomes visible again (mobile tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (sessionId || urlSessionId)) {
    if (!wsTerm || wsTerm.readyState === WebSocket.CLOSED || wsTerm.readyState === WebSocket.CLOSING) {
      console.log('[Visibility] Page visible, reconnecting...');
      wsTermReconnectAttempts = 0;
      createTerminalWebSocket();
    }
  }
});

// Initialize WebSocket connection
wsTerm = createTerminalWebSocket();

// Unified input method
term.input = (data) => {
  if (wsTerm && wsTerm.readyState === WebSocket.OPEN) {
    wsTerm.send(data);
  } else {
    console.error('[Terminal] WS Error: Cannot send data, socket state:', wsTerm ? wsTerm.readyState : 'undefined');
  }
};

// --- Double-click to select line logic ---
let lastTapTime = 0;

function handleDoubleAction(e) {
  console.log('[Terminal] Double-click/tap captured: scrolling to bottom');
  if (e && e.cancelable) {
    e.preventDefault();
    e.stopPropagation();
  }
  term.scrollToBottom();
}

function isCoarsePointerDevice() {
  try {
    return !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function blurXtermHelperTextarea() {
  const helperTextarea = terminalEl.querySelector('.xterm-helper-textarea');
  if (helperTextarea && document.activeElement === helperTextarea) {
    try { helperTextarea.blur(); } catch { /* ignore */ }
  }
}

function shouldAllowImeForTerminalTap(clientX, clientY) {
  // Prefer the actual xterm hidden textarea position (it tracks the cursor).
  const helperTextarea = terminalEl.querySelector('.xterm-helper-textarea');
  if (helperTextarea) {
    const rect = helperTextarea.getBoundingClientRect();
    if (
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.right) &&
      Number.isFinite(rect.bottom)
    ) {
      // Expand the target area to be finger-friendly.
      const pad = 24;
      const left = rect.left - pad;
      const right = rect.right + pad;
      const top = rect.top - pad;
      const bottom = rect.bottom + pad;
      return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
    }
  }

  // Fallback: allow if the tap is on the cursor's current buffer row.
  try {
    const screen = terminalEl.querySelector('.xterm-screen');
    if (!screen) return true;
    const screenRect = screen.getBoundingClientRect();
    const cellHeight = getApproxCellHeight();
    if (!cellHeight) return true;

    const rowWithinViewport = Math.floor((clientY - screenRect.top) / cellHeight);
    const tappedBufferRow = rowWithinViewport + term.buffer.active.viewportY;
    const cursorBufferRow = term.buffer.active.baseY + term.buffer.active.cursorY;
    return tappedBufferRow === cursorBufferRow;
  } catch {
    return true;
  }
}

terminalEl.addEventListener('mousedown', (e) => {
  if (e.detail === 2) {
    handleDoubleAction(e);
  } else {
    // Single click: focus if near cursor
    const allowIme = shouldAllowImeForTerminalTap(e.clientX, e.clientY);
    if (allowIme) {
      term.focus();
    }
  }
}, { capture: true });

let touchScrollActive = false;
let lastTouchY = null;
let lastTouchX = null;
let lastTouchTime = null;
let touchVelocity = 0;
let momentumId = null;

function stopMomentum() {
  if (momentumId) {
    cancelAnimationFrame(momentumId);
    momentumId = null;
  }
  touchVelocity = 0;
}

function startMomentum() {
  stopMomentum();
  let lastTime = Date.now();
  
  const step = () => {
    const now = Date.now();
    const dt = now - lastTime;
    lastTime = now;
    
    if (Math.abs(touchVelocity) < 0.01) {
      momentumId = null;
      return;
    }
    
    // Scroll based on velocity (lines per ms)
    const linesToScroll = touchVelocity * dt;
    if (Math.abs(linesToScroll) >= 1) {
      term.scrollLines(Math.trunc(linesToScroll));
    }
    
    touchVelocity *= 0.95; // Friction
    momentumId = requestAnimationFrame(step);
  };
  momentumId = requestAnimationFrame(step);
}

terminalEl.addEventListener('touchstart', (e) => {
  stopMomentum();
  lastTouchX = null;
  const now = Date.now();
  if (now - lastTapTime < 300 && e.touches.length === 1) {
    handleDoubleAction(e);
    lastTapTime = now;
    return;
  }
  lastTapTime = now;

  // Mobile: don't bring up the IME unless the user taps near the cursor/focus position.
  if (isCoarsePointerDevice() && e.touches && e.touches.length === 1) {
    const t = e.touches[0];
    const allowIme = shouldAllowImeForTerminalTap(t.clientX, t.clientY);
    if (!allowIme) {
      const helperTextarea = terminalEl.querySelector('.xterm-helper-textarea');
      if (helperTextarea && document.activeElement === helperTextarea) {
        try { helperTextarea.blur(); } catch { /* ignore */ }
      }

      // Stop propagation so xterm doesn't see the tap and focus.
      // Do NOT preventDefault, allowing native browser logic (like long-press selection) to work.
      e.stopPropagation();
    } else {
      // Near cursor: immediately focus
      term.focus();
    }
  }
}, { passive: false, capture: true });

// --- Mobile: thumb swipe to scroll with inertia ---
function getApproxCellHeight() {
  try {
    const h = term?._core?._renderService?.dimensions?.actualCellHeight;
    if (h) return h;
  } catch {
    // ignore
  }

  const screen = terminalEl.querySelector('.xterm-screen');
  if (screen) {
    const rect = screen.getBoundingClientRect();
    if (rect.height > 0 && term?.rows) return rect.height / term.rows;
  }
  return 0;
}

terminalEl.addEventListener('touchmove', (e) => {
  if (!e.touches || e.touches.length !== 1) return;

  const currentY = e.touches[0].clientY;
  const currentX = e.touches[0].clientX;
  const currentTime = Date.now();
  
  if (lastTouchY == null || lastTouchX == null) {
    lastTouchY = currentY;
    lastTouchX = currentX;
    lastTouchTime = currentTime;
    return;
  }

  const deltaY = currentY - lastTouchY;
  const deltaX = currentX - lastTouchX;
  const deltaTime = currentTime - lastTouchTime;
  const absDeltaY = Math.abs(deltaY);
  const absDeltaX = Math.abs(deltaX);

  // Only start scrolling after a small threshold
  if (!touchScrollActive) {
    if (absDeltaY < 6 && absDeltaX < 6) return;
    touchScrollActive = true;
  }

  // Horizontal scroll: manual viewport manipulation
  if (absDeltaX > 5) {
    const viewport = terminalEl.querySelector('.xterm-viewport');
    if (viewport) {
      viewport.scrollLeft -= deltaX;
      lastTouchX = currentX;
    }
  }

  const cellHeight = getApproxCellHeight();
  if (cellHeight > 0) {
    const lines = Math.trunc(deltaY / cellHeight);
    if (lines !== 0) {
      term.scrollLines(-lines);
      lastTouchY = currentY;
      lastTouchTime = currentTime;
      if (deltaTime > 0) {
        touchVelocity = -lines / deltaTime;
      }
    }
  }

  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
}, { passive: false, capture: true });

terminalEl.addEventListener('touchend', () => {
  if (touchScrollActive && Math.abs(touchVelocity) > 0.01) {
    startMomentum();
  }
  touchScrollActive = false;
  lastTouchY = null;
  lastTouchX = null;
  lastTouchTime = null;
}, { capture: true });

terminalEl.addEventListener('touchcancel', () => {
  stopMomentum();
  touchScrollActive = false;
  lastTouchY = null;
  lastTouchX = null;
  lastTouchTime = null;
}, { capture: true });


function attachTerminal() {
  attached = true;
  
  // Reset terminal to avoid duplicating history on reconnect
  term.reset();

  if (pendingOutput.length) {
    term.write(pendingOutput.join(''));
    pendingOutput = [];
  }

  setupResizeControl();
}

// --- Command History & Drawer Logic ---
const quickActions = document.getElementById('quick-actions');
const vkDrawer = document.getElementById('vk-drawer');
const qaEditorBtn = document.getElementById('qa-editor-btn');
const openQaEditorBtn = document.getElementById('open-qa-editor-btn');
const qaEditorModal = document.getElementById('qa-editor-modal');
const closeQaEditorBtn = document.getElementById('close-qa-editor-btn');
const qaEditorList = document.getElementById('qa-editor-list');
const qaEditorNewCmd = document.getElementById('qa-editor-new-cmd');
const qaEditorNewAlias = document.getElementById('qa-editor-new-alias');
const qaEditorAddBtn = document.getElementById('qa-editor-add-btn');

// Removed qa-history element, rendering directly to quick-actions
let commandHistory = [];

// Voice dictation buffer: accumulate multiple recordings into one input line.
let pendingVoiceBuffer = '';

function clearPendingVoiceBuffer() {
  pendingVoiceBuffer = '';
}

function shouldInsertSpaceBetween(a, b) {
  if (!a || !b) return false;
  const last = a[a.length - 1];
  const first = b[0];
  if (/\s/.test(last) || /\s/.test(first)) return false;
  // Don't insert spaces before common punctuation.
  if (/^[,.;:!?，。！？、)}\]]/.test(first)) return false;
  if (/[({\[]$/.test(last)) return false;
  return true;
}

function appendVoiceToTerminal(text) {
  const cleaned = typeof text === 'string' ? text.trim() : '';
  if (!cleaned) return;
  const needsSpace = shouldInsertSpaceBetween(pendingVoiceBuffer, cleaned);
  const toAppend = (needsSpace ? ' ' : '') + cleaned;
  pendingVoiceBuffer += toAppend;

  // Append into the current prompt without executing.
  term.input(toAppend);
}

const QUICK_ACTION_ALIASES_KEY = 'quick_action_aliases';
let quickActionAliases = {};

function loadQuickActionAliases() {
  try {
    const raw = localStorage.getItem(QUICK_ACTION_ALIASES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveQuickActionAliases() {
  try {
    localStorage.setItem(QUICK_ACTION_ALIASES_KEY, JSON.stringify(quickActionAliases));
  } catch {}
}

function normalizeAliasList(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',');

  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const alias = String(part ?? '').trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

function getAliasesForCommand(cmd) {
  const key = typeof cmd === 'string' ? cmd.trim() : '';
  if (!key) return [];
  return normalizeAliasList(quickActionAliases[key] || []);
}

function setAliasesForCommand(cmd, aliases) {
  const key = typeof cmd === 'string' ? cmd.trim() : '';
  if (!key) return;
  const normalized = normalizeAliasList(aliases);
  if (normalized.length === 0) {
    delete quickActionAliases[key];
  } else {
    quickActionAliases[key] = normalized;
  }
  saveQuickActionAliases();
}

function pruneAliasesForCommands(commands) {
  const keep = new Set((Array.isArray(commands) ? commands : []).map((c) => String(c).trim()).filter(Boolean));
  let changed = false;
  for (const key of Object.keys(quickActionAliases || {})) {
    if (!keep.has(key)) {
      delete quickActionAliases[key];
      changed = true;
    }
  }
  if (changed) saveQuickActionAliases();
}

function renameQuickAction(oldCmd, newCmd) {
  const oldKey = typeof oldCmd === 'string' ? oldCmd.trim() : '';
  const newKey = typeof newCmd === 'string' ? newCmd.trim() : '';
  if (!oldKey || !newKey || oldKey === newKey) return;
  if (Object.prototype.hasOwnProperty.call(quickActionAliases || {}, oldKey)) {
    quickActionAliases[newKey] = normalizeAliasList(quickActionAliases[oldKey] || []);
    delete quickActionAliases[oldKey];
    saveQuickActionAliases();
  }
}

function normalizeQuickActionCmd(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const candidate = value.cmd ?? value.command ?? value.text ?? value.label ?? value.value;
    if (typeof candidate === 'string') return candidate;
  }
  if (value == null) return '';
  return String(value);
}

function normalizeQuickActions(commands) {
  if (!Array.isArray(commands)) return [];
  return commands
    .map(normalizeQuickActionCmd)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// Initialize from LocalStorage or Default
try {
  const saved = localStorage.getItem('quick_actions');
  if (saved) {
    commandHistory = normalizeQuickActions(JSON.parse(saved));
  } else {
    // Default commands if nothing in LS
    commandHistory = normalizeQuickActions(['/help', '/clear', '/resume', '/stats', '/exit']);
  }
} catch (e) {
  console.warn('Failed to load quick actions from LS', e);
}

quickActionAliases = loadQuickActionAliases();
pruneAliasesForCommands(commandHistory);

function renderHistory(commands) {
  if (!quickActions) return;
  commandHistory = normalizeQuickActions(commands);
  pruneAliasesForCommands(commandHistory);
  
  // Persist to LocalStorage whenever we render (update)
  try {
    localStorage.setItem('quick_actions', JSON.stringify(commandHistory));
  } catch (e) {}

  // Render Drawer
  quickActions.innerHTML = '';

  // First button: open Quick Actions editor
  const qaManageBtn = document.createElement('button');
  qaManageBtn.className = 'qa-btn qa-btn-icon';
  qaManageBtn.textContent = '⚙';
  qaManageBtn.title = 'Manage Quick Actions';
  qaManageBtn.setAttribute('aria-label', 'Manage Quick Actions');
  qaManageBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openQaEditor();
  });
  quickActions.appendChild(qaManageBtn);

  commandHistory.forEach(cmd => {
    const btn = document.createElement('button');
    btn.className = 'qa-btn';
    btn.textContent = cmd;
    btn.title = cmd;
    btn.addEventListener('click', () => {
      const cleanCmd = cmd.trim();
      console.log('[Drawer] Sending:', cleanCmd);
      term.input(cleanCmd);
      
      // Delay sending Enter to mimic human typing and avoid buffer merging issues
      setTimeout(() => {
        console.log('[Drawer] Sending Enter');
        term.input('\r');
        clearPendingVoiceBuffer();
      }, 50);

      quickActions.classList.remove('visible');
      vkDrawer.classList.remove('active');
      
      // 只有在非移动端（即有物理键盘）时才自动恢复焦点
      if (!isCoarsePointerDevice()) {
        term.focus();
      }
    });
    quickActions.appendChild(btn);
  });
}

function isQaEditorOpen() {
  return !!(qaEditorModal && qaEditorModal.classList.contains('visible'));
}

function renderQuickActionsEditor() {
  if (!qaEditorList) return;
  qaEditorList.innerHTML = '';

  commandHistory.forEach((cmd, index) => {
    const row = document.createElement('div');
    row.className = 'qa-edit-row';

    const cmdWrap = document.createElement('div');
    cmdWrap.className = 'qa-edit-cmd';
    const cmdInput = document.createElement('input');
    cmdInput.className = 'qa-edit-input';
    cmdInput.type = 'text';
    cmdInput.value = cmd;
    cmdInput.spellcheck = false;
    cmdInput.autocapitalize = 'off';
    cmdInput.autocomplete = 'off';

    const aliasWrap = document.createElement('div');
    aliasWrap.className = 'qa-edit-alias';
    const aliasInput = document.createElement('input');
    aliasInput.className = 'qa-edit-input';
    aliasInput.type = 'text';
    aliasInput.placeholder = 'Alias (comma-separated)';
    aliasInput.value = getAliasesForCommand(cmd).join(', ');
    aliasInput.spellcheck = false;
    aliasInput.autocapitalize = 'off';
    aliasInput.autocomplete = 'off';

    const delBtn = document.createElement('button');
    delBtn.className = 'qa-edit-del';
    delBtn.textContent = 'Del';

    const commitRename = () => {
      const next = cmdInput.value.trim();
      const prev = String(cmd).trim();
      if (!next) {
        cmdInput.value = cmd;
        return;
      }
      if (next === prev) return;
      if (commandHistory.includes(next)) {
        cmdInput.value = cmd;
        return;
      }

      const newCmds = [...commandHistory];
      newCmds[index] = next;
      renameQuickAction(prev, next);
      renderHistory(newCmds);
      updateQuickActionsOnServer(newCmds);
    };

    cmdInput.addEventListener('blur', () => {
      commitRename();
      if (isQaEditorOpen()) renderQuickActionsEditor();
    });
    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        cmdInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cmdInput.value = cmd;
        cmdInput.blur();
      }
    });

    aliasInput.addEventListener('change', () => {
      // Ensure command rename is applied before binding aliases.
      const desiredAliases = aliasInput.value;
      commitRename();
      const effectiveCmd = commandHistory[index] || cmdInput.value || cmd;
      setAliasesForCommand(effectiveCmd, desiredAliases);
      if (isQaEditorOpen()) renderQuickActionsEditor();
    });
    aliasInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        aliasInput.blur();
      }
    });

    delBtn.addEventListener('click', () => {
      const toDelete = String(commandHistory[index] ?? cmd).trim();
      const newCmds = [...commandHistory];
      newCmds.splice(index, 1);
      if (toDelete) {
        delete quickActionAliases[toDelete];
        saveQuickActionAliases();
      }
      renderHistory(newCmds);
      updateQuickActionsOnServer(newCmds);
      if (isQaEditorOpen()) renderQuickActionsEditor();
    });

    cmdWrap.appendChild(cmdInput);
    aliasWrap.appendChild(aliasInput);
    row.appendChild(cmdWrap);
    row.appendChild(aliasWrap);
    row.appendChild(delBtn);
    qaEditorList.appendChild(row);
  });
}

function openQaEditor() {
  if (!qaEditorModal) return;
  renderQuickActionsEditor();
  qaEditorModal.classList.add('visible');
  qaEditorModal.style.display = 'flex';
  void qaEditorModal.offsetWidth;
  qaEditorModal.style.opacity = '1';
  if (qaEditorNewCmd) qaEditorNewCmd.focus();
}

function closeQaEditor() {
  if (!qaEditorModal) return;
  qaEditorModal.classList.remove('visible');
  qaEditorModal.style.opacity = '0';
  setTimeout(() => {
    if (!qaEditorModal.classList.contains('visible')) {
      qaEditorModal.style.display = 'none';
    }
  }, 200);
  term.focus();
}

if (qaEditorBtn) qaEditorBtn.addEventListener('click', (e) => { e.preventDefault(); openQaEditor(); });
if (openQaEditorBtn) openQaEditorBtn.addEventListener('click', (e) => {
  e.preventDefault();
  // Avoid stacking with Settings modal.
  try {
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.classList.contains('visible')) {
      settingsModal.classList.remove('visible');
      settingsModal.style.opacity = '0';
      setTimeout(() => { if (!settingsModal.classList.contains('visible')) settingsModal.style.display = 'none'; }, 200);
    }
  } catch {}
  openQaEditor();
});
if (closeQaEditorBtn) closeQaEditorBtn.addEventListener('click', (e) => { e.preventDefault(); closeQaEditor(); });
if (qaEditorModal) {
  qaEditorModal.addEventListener('click', (e) => {
    if (e.target === qaEditorModal) closeQaEditor();
  });
}

if (qaEditorAddBtn) {
  qaEditorAddBtn.addEventListener('click', () => {
    const cmd = (qaEditorNewCmd?.value || '').trim();
    if (!cmd) return;
    if (commandHistory.includes(cmd)) return;

    const aliases = qaEditorNewAlias?.value || '';
    const newCmds = [...commandHistory, cmd];
    renderHistory(newCmds);
    updateQuickActionsOnServer(newCmds);
    setAliasesForCommand(cmd, aliases);
    if (qaEditorNewCmd) qaEditorNewCmd.value = '';
    if (qaEditorNewAlias) qaEditorNewAlias.value = '';
    if (isQaEditorOpen()) renderQuickActionsEditor();
    if (qaEditorNewCmd) qaEditorNewCmd.focus();
  });
}

if (qaEditorNewCmd) {
  qaEditorNewCmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && qaEditorAddBtn) {
      e.preventDefault();
      qaEditorAddBtn.click();
    }
  });
}

// Initial render
renderHistory(commandHistory);

let wsCtl = null;
let wsCtlReconnectAttempts = 0;
let resizeObserver = null;
let resizeCleanupFn = null;

function updateQuickActionsOnServer(commands) {
  if (wsCtl && wsCtl.readyState === WebSocket.OPEN) {
    wsCtl.send(JSON.stringify({ type: 'update_quick_actions', commands }));
  }
}

function reconnectCtlSocket() {
  if (!sessionId) return;
  if (wsCtlReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) return;
  
  wsCtlReconnectAttempts++;
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(1.5, wsCtlReconnectAttempts - 1), 30000);
  
  setTimeout(() => {
    if (document.visibilityState !== 'hidden' && sessionId) {
      setupResizeControl();
    }
  }, delay);
}

// Quick actions are edited via the standalone modal now.

function setupResizeControl() {
  // Clean up existing connection
  if (wsCtl) {
    wsCtl.close();
  }
  
  // Clean up existing observers/listeners
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (resizeCleanupFn) {
    resizeCleanupFn();
    resizeCleanupFn = null;
  }
  
  const ctlWsUrl = `${proto}//${location.host}/ctl?sessionId=${encodeURIComponent(sessionId)}`;
  wsCtl = new WebSocket(ctlWsUrl);
  
  let lastCols = term.cols;
  let lastRows = term.rows;
  const sendResize = () => {
    fitAddon.fit();
    if (term.cols === lastCols && term.rows === lastRows) return;
    lastCols = term.cols;
    lastRows = term.rows;
    
    if (wsCtl && wsCtl.readyState === WebSocket.OPEN) {
      wsCtl.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
    // 确保在排版调整后滚动到底部
    setTimeout(() => term.scrollToBottom(), 10);
  };
  
  // Expose for other UI controls (font size, etc.)
  window.termSendResize = sendResize;

  wsCtl.addEventListener('open', () => {
    console.log('[Control] Connected');
    wsCtlReconnectAttempts = 0;
    sendResize();
    // Push local data to initialize server if needed
    wsCtl.send(JSON.stringify({ type: 'client_commands_push', commands: commandHistory }));
  });

  wsCtl.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg && msg.type === 'session_joined') {
        console.log('[Control] Session joined, closing QR modal');
        if (qrModal && qrModal.style.display !== 'none') {
          qrModal.style.display = 'none';
          term.focus();
        }
      } else if (msg && msg.type === 'history_update') {
        // Server authority update
        renderHistory(msg.commands);
        if (isQaEditorOpen()) renderQuickActionsEditor();
      } else if (msg && msg.type === 'resize') {
        // Received PTY resize broadcast from another client (e.g. Desktop)
        console.log(`[Control] Remote resize received: ${msg.cols}x${msg.rows}`);
        term.resize(msg.cols, msg.rows);
        // Scroll to bottom after layout shift
        setTimeout(() => term.scrollToBottom(), 50);
      }
    } catch (err) {
      console.warn('[Control] Failed to parse message:', err);
    }
  });
  
  wsCtl.addEventListener('close', () => {
    console.log('[Control] Disconnected');
    reconnectCtlSocket();
  });
  
  wsCtl.addEventListener('error', (err) => {
    console.error('[Control] Error:', err);
  });

  // Use ResizeObserver for more robust container size detection
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      clearTimeout(window.resizeTimeout);
      window.resizeTimeout = setTimeout(() => sendResize(), 100);
    });
    resizeObserver.observe(document.getElementById('terminal-container'));
  } else {
    const handleResize = () => {
      clearTimeout(window.resizeTimeout);
      window.resizeTimeout = setTimeout(() => sendResize(), 100);
    };
    window.addEventListener('resize', handleResize);
    resizeCleanupFn = () => window.removeEventListener('resize', handleResize);
  }
  
  // Visual Viewport API for mobile keyboard resizing
  if (window.visualViewport) {
    const handleVisualResize = () => {
      // Adjust terminal container height based on keyboard and sync with PTY
      clearTimeout(window.resizeTimeout);
      window.resizeTimeout = setTimeout(() => {
        sendResize();
        term.scrollToBottom();
      }, 300);
    };
    window.visualViewport.addEventListener('resize', handleVisualResize);
    
    const prevCleanup = resizeCleanupFn;
    resizeCleanupFn = () => {
      if (prevCleanup) prevCleanup();
      window.visualViewport.removeEventListener('resize', handleVisualResize);
    };
  }
}

// --- Mobile UI Logic ---

// Font Size Control
const fontDecBtn = document.getElementById('font-dec-btn');
const fontIncBtn = document.getElementById('font-inc-btn');

function updateFontSize(delta) {
  const newSize = Math.max(10, Math.min(32, term.options.fontSize + delta));
  term.options.fontSize = newSize;
  localStorage.setItem('terminalFontSize', newSize);
  
  if (window.termSendResize) {
    window.termSendResize();
  } else {
    fitAddon.fit();
  }
}

fontDecBtn.addEventListener('click', () => updateFontSize(-1));
fontIncBtn.addEventListener('click', () => updateFontSize(1));

// Clear Buffer
const clearBtn = document.getElementById('clear-btn');
clearBtn.addEventListener('click', () => {
  term.clear();
  clearPendingVoiceBuffer();
  // Hack to clear scrollback buffer
  term.options.scrollback = 0;
  setTimeout(() => {
    term.options.scrollback = 10000;
  }, 10);
  
  if (!isCoarsePointerDevice()) {
    term.focus();
  }
});

// Virtual Keys
const vkEsc = document.getElementById('vk-esc');
const vkTab = document.getElementById('vk-tab');
const vkCtrlC = document.getElementById('vk-ctrl-c');
const vkUp = document.getElementById('vk-up');
const vkDown = document.getElementById('vk-down');
const vkLeft = document.getElementById('vk-left');
const vkRight = document.getElementById('vk-right');
const vkEnter = document.getElementById('vk-enter');
// vkDrawer is declared above now

const vk1 = document.getElementById('vk-1');
const vk2 = document.getElementById('vk-2');
const vk3 = document.getElementById('vk-3');
const vk4 = document.getElementById('vk-4');
const vkSlash = document.getElementById('vk-slash');
const vkAt = document.getElementById('vk-at');
const vkBackspace = document.getElementById('vk-backspace');

// quickActions is declared above now

window.handleVirtualKey = function(text) {
  if (term) {
    // Virtual keyboard should not trigger IME on mobile.
    if (isCoarsePointerDevice()) {
      blurXtermHelperTextarea();
    } else {
      term.focus();
    }
    term.input(text);
    if (text === '\r' || text === '\x03') {
      clearPendingVoiceBuffer();
    }
  }
};

function onClick(el, handler) {
  if (!el) return;
  el.addEventListener('click', handler);
}

onClick(vkEsc, (e) => { e.preventDefault(); window.handleVirtualKey('\x1b'); });
onClick(vkTab, (e) => { e.preventDefault(); window.handleVirtualKey('\t'); });
onClick(vkBackspace, (e) => { e.preventDefault(); window.handleVirtualKey('\x7f'); });
onClick(vkCtrlC, (e) => { e.preventDefault(); window.handleVirtualKey('\x03'); }); // Ctrl+C

onClick(vkUp, (e) => { e.preventDefault(); window.handleVirtualKey('\x1b[A'); });
onClick(vkDown, (e) => { e.preventDefault(); window.handleVirtualKey('\x1b[B'); });
onClick(vkLeft, (e) => { e.preventDefault(); window.handleVirtualKey('\x1b[D'); });
onClick(vkRight, (e) => { e.preventDefault(); window.handleVirtualKey('\x1b[C'); });
onClick(vkEnter, (e) => { e.preventDefault(); window.handleVirtualKey('\r'); });

onClick(vk1, (e) => { e.preventDefault(); window.handleVirtualKey('1'); });
onClick(vk2, (e) => { e.preventDefault(); window.handleVirtualKey('2'); });
onClick(vk3, (e) => { e.preventDefault(); window.handleVirtualKey('3'); });
onClick(vk4, (e) => { e.preventDefault(); window.handleVirtualKey('4'); });

onClick(vkSlash, (e) => { e.preventDefault(); window.handleVirtualKey('/'); });
onClick(vkAt, (e) => { e.preventDefault(); window.handleVirtualKey('@'); });

// Toggle Quick Actions Drawer
onClick(vkDrawer, (e) => {
  e.preventDefault();
  if (!quickActions) return;
  quickActions.classList.toggle('visible');
  vkDrawer.classList.toggle('active', quickActions.classList.contains('visible'));
});

// Close Quick Actions Drawer on terminal interaction
function closeQuickActions() {
  if (quickActions && quickActions.classList.contains('visible')) {
    quickActions.classList.remove('visible');
    vkDrawer.classList.remove('active');
  }
}

terminalEl.addEventListener('click', closeQuickActions, { capture: true });
terminalEl.addEventListener('touchstart', closeQuickActions, { passive: true, capture: true });

// Settings Modal & Theme Management
const settingsModal = document.getElementById('settings-modal');
const themeSelect = document.getElementById('modal-theme-select');
const settingsBtn = document.getElementById('settings-btn');
const closeModalBtn = document.getElementById('close-modal-btn');

function toggleSettings() {
  if (!settingsModal) return;
  settingsModal.classList.toggle('visible');
  if (settingsModal.classList.contains('visible')) {
    settingsModal.style.display = 'flex'; // Force display
    // Force reflow
    void settingsModal.offsetWidth;
    settingsModal.style.opacity = '1';
    if (themeSelect) themeSelect.focus();
  } else {
    settingsModal.style.opacity = '0';
    setTimeout(() => {
      if (!settingsModal.classList.contains('visible')) {
        settingsModal.style.display = 'none';
      }
    }, 200);
    term.focus();
  }
}

onClick(settingsBtn, toggleSettings);
onClick(closeModalBtn, toggleSettings);
if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) toggleSettings();
  });
}


// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close QA editor first (if open), then Settings.
    const qaModal = document.getElementById('qa-editor-modal');
    if (qaModal && qaModal.classList.contains('visible')) {
      closeQaEditor();
      return;
    }
    if (settingsModal && settingsModal.classList.contains('visible')) {
      toggleSettings();
    }
  }

  // Best-effort: if user submits with physical Enter, clear the dictation buffer.
  if (e.key === 'Enter' && !e.isComposing) {
    const tag = (document.activeElement && document.activeElement.tagName) ? document.activeElement.tagName.toLowerCase() : '';
    if (tag !== 'input' && tag !== 'textarea') {
      clearPendingVoiceBuffer();
    }
  }
});

function mapThemeKeys(jsonTheme) {
  const mapping = {
    purple: 'magenta',
    brightPurple: 'brightMagenta',
    cursorColor: 'cursor',
    selectionBackground: 'selectionBackground',
  };
  
  const newTheme = { ...jsonTheme };
  
  for (const [key, value] of Object.entries(jsonTheme)) {
    if (mapping[key]) {
      newTheme[mapping[key]] = value;
    }
  }
  
  const finalTheme = {};
  const standardKeys = [
    'foreground', 'background', 'cursor', 'cursorAccent', 'selectionBackground', 'selectionForeground', 'selectionInactiveBackground',
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
  ];

  standardKeys.forEach(k => {
    if (jsonTheme[k]) finalTheme[k] = jsonTheme[k];
  });

  if (jsonTheme.purple) finalTheme.magenta = jsonTheme.purple;
  if (jsonTheme.brightPurple) finalTheme.brightMagenta = jsonTheme.brightPurple;
  if (jsonTheme.cursorColor) finalTheme.cursor = jsonTheme.cursorColor;

  return finalTheme;
}

async function loadThemeList() {
  try {
    const res = await fetch('/api/themes');
    const themes = await res.json();
    
    // Clear loading option
    themeSelect.innerHTML = '';
    
    // Add "Default" option
    const defaultThemeOption = document.createElement('option');
    defaultThemeOption.value = "Default";
    defaultThemeOption.textContent = "Default";
    themeSelect.appendChild(defaultThemeOption);

    themes.sort().forEach(themeName => {
      const option = document.createElement('option');
      option.value = themeName;
      option.textContent = themeName;
      themeSelect.appendChild(option);
    });

    // Load saved theme or default to "Default"
    const savedTheme = localStorage.getItem('selectedTheme');
    if (savedTheme && (themes.includes(savedTheme) || savedTheme === 'Default')) {
      themeSelect.value = savedTheme;
      applyTheme(savedTheme);
    } else {
      // Default to "Default" (customTheme)
      themeSelect.value = 'Default';
      applyTheme('Default');
    }
  } catch (err) {
    console.error('Failed to load themes:', err);
    if (themeSelect) themeSelect.innerHTML = '<option disabled>Error loading themes</option>';
  }
}

async function applyTheme(themeName) {
  if (!themeName) return;
  
  if (themeName === 'Default') {
     term.options.theme = customTheme;
     if (customTheme.background) {
      document.body.style.background = customTheme.background;
      document.getElementById('terminal-container').style.background = customTheme.background;
     }
     localStorage.setItem('selectedTheme', 'Default');
     return;
  }

  try {
    const res = await fetch(`/themes/${encodeURIComponent(themeName)}.json`);
    const jsonTheme = await res.json();
    const xtermTheme = mapThemeKeys(jsonTheme);
    
    term.options.theme = xtermTheme;
    
    if (xtermTheme.background) {
      document.body.style.background = xtermTheme.background;
      document.getElementById('terminal-container').style.background = xtermTheme.background;
    }
    
    localStorage.setItem('selectedTheme', themeName);
  } catch (err) {
    console.error(`Failed to apply theme ${themeName}:`, err);
  }
}

// themeSelect.addEventListener('change', (e) => {
//   if (e.target.value) {
//     applyTheme(e.target.value);
//   }
// });

const resetSettingsBtn = document.getElementById('reset-settings-btn');
const applySettingsBtn = document.getElementById('apply-settings-btn');
const clearVoiceModelCacheBtn = document.getElementById('clear-voice-model-cache-btn');
const voiceModelCacheHint = document.getElementById('voice-model-cache-hint');

onClick(resetSettingsBtn, () => {
  if (themeSelect) themeSelect.value = 'Default';
  applyTheme('Default');
  
  // Reset font size
  term.options.fontSize = 14;
  localStorage.setItem('terminalFontSize', 14);
  if (window.termSendResize) {
    window.termSendResize();
  }
});

onClick(applySettingsBtn, () => {
  if (themeSelect && themeSelect.value) {
    applyTheme(themeSelect.value);
    toggleSettings(); // Close modal
  }
});

onClick(clearVoiceModelCacheBtn, async () => {
  try {
    if (typeof caches === 'undefined' || typeof caches.delete !== 'function') {
      const msg = 'CacheStorage API not available in this browser context.';
      if (voiceModelCacheHint) voiceModelCacheHint.textContent = msg;
      return;
    }

    const cacheName = (window.SenseVoiceProcessor && window.SenseVoiceProcessor.MODEL_CACHE_NAME)
      ? window.SenseVoiceProcessor.MODEL_CACHE_NAME
      : 'voicecode-sensevoice-model-cache-v1';

    const ok = await caches.delete(cacheName);
    const msg = ok ? 'Voice model cache cleared. Reload to refetch.' : 'No voice model cache found.';
    if (voiceModelCacheHint) voiceModelCacheHint.textContent = msg;
    setVoiceModelStatus('Voice: Idle');
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    if (voiceModelCacheHint) voiceModelCacheHint.textContent = `Failed to clear cache: ${msg}`;
  }
});

// QR Code Logic
const qrBtn = document.getElementById('qr-btn');
const newSessionBtn = document.getElementById('new-session-btn');
const qrModal = document.getElementById('qr-modal');
const qrImage = document.getElementById('qr-image');
const closeQrBtn = document.getElementById('close-qr-btn');

onClick(newSessionBtn, () => {
  window.open('/', '_blank');
});

onClick(qrBtn, async () => {
  // Use current URL, but try to replace localhost with LAN IP from server
  let url = window.location.href;
  try {
    const infoRes = await fetch('/api/info');
    if (infoRes.ok) {
      const info = await infoRes.json();
      const currentUrl = new URL(window.location.href);

      // Prefer public tunnel if available (ngrok), preserving session path.
      if (info.tunnelUrl && typeof info.tunnelUrl === 'string' && info.tunnelUrl.startsWith('http')) {
        try {
          const tunnelBase = new URL(info.tunnelUrl);
          tunnelBase.pathname = currentUrl.pathname;
          tunnelBase.search = currentUrl.search;
          tunnelBase.hash = currentUrl.hash;
          url = tunnelBase.toString();
        } catch {
          // ignore invalid tunnel url
        }
      } else if (info.localIp) {
        if (currentUrl.hostname === 'localhost' || currentUrl.hostname === '127.0.0.1') {
          currentUrl.hostname = info.localIp;
          url = currentUrl.toString();
        }
      }
    }
  } catch (err) {
    console.warn('Failed to fetch server info, using current URL for QR code', err);
  }

  try {
    const res = await fetch(`/api/qrcode?text=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.dataUrl) {
      qrImage.src = data.dataUrl;
      qrModal.style.display = 'flex';
      qrModal.style.opacity = '1';
    }
  } catch (err) {
    console.error('Failed to load QR code', err);
    alert('Could not generate QR code');
  }
});

onClick(closeQrBtn, () => {
  if (!qrModal) return;
  qrModal.style.display = 'none';
  term.focus();
});

if (qrModal) {
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) {
      qrModal.style.display = 'none';
      term.focus();
    }
  });
}

// Initialize
if (themeSelect) {
  loadThemeList();
}

// --- Voice Input Integration ---
// Assumes VoiceRecognizer is loaded via script tag (or bundled)
// Note: We need to ensure voice-recognizer.js and audio-capture.js, vosk-browser are loaded.
// index.html needs those script tags.

const pttBtn = document.getElementById('ptt-btn');
const recordingOverlay = document.getElementById('recording-overlay');
let voiceRecognizer = null;

if (window.VoiceRecognizer && pttBtn) {
  voiceRecognizer = new window.VoiceRecognizer();

  // Warm the model in the background to reduce the perceived delay on first PTT.
  // This is compute-only and benefits from the browser HTTP cache/SW cache.
  const warmInit = () => {
    if (voiceRecognizer && !voiceRecognizer.isReady) {
      setVoiceModelStatus('Voice: Loading…');
      voiceRecognizer
        .init()
        .then(() => setVoiceModelStatus('Voice: Ready'))
        .catch((err) => {
          // ignore; user can still trigger init on first press
          setVoiceModelStatus('Voice: Error', err);
        });
    } else if (voiceRecognizer && voiceRecognizer.isReady) {
      setVoiceModelStatus('Voice: Ready');
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warmInit, { timeout: 2000 });
  } else {
    setTimeout(warmInit, 0);
  }
  
  // Initialize on first user interaction to unlock audio context if needed
  // or wait for first press.
  
  // PTT Logic
  let pttState = 'idle'; // idle | starting | recording | stopping
  let isPTTPressed = false;
  let activePointerId = null;
  let shouldStopAfterStart = false;
  let startPromise = null;

  const stopIfRecording = async (reason) => {
    if (pttState === 'idle') return;
    if (pttState === 'stopping') return;
    if (window.DEBUG_VOICE) console.log('PTT: Auto-stopping due to', reason);
    const ev = { __pttForceStop: true, type: reason, cancelable: false };
    try {
      await stopRecording(ev);
    } catch {
      // ignore
    }
  };

  // If the tab goes to background or loses focus, do not keep recording.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopIfRecording('visibilitychange');
  });
  window.addEventListener('blur', () => stopIfRecording('blur'));
  window.addEventListener('pagehide', () => stopIfRecording('pagehide'));

  const startRecording = async (e) => {
    if (e && e.cancelable) e.preventDefault();
    if (pttState !== 'idle') return;
    
    if (window.DEBUG_VOICE) console.log('PTT: Start triggered', e.type);
    isPTTPressed = true;
    shouldStopAfterStart = false;
    pttState = 'starting';

    // 如果是移动端，录音开始时立即隐藏键盘
    if (isCoarsePointerDevice()) {
      blurXtermHelperTextarea();
    }

    // 关键：捕获指针，确保手指滑出按钮也能收到 pointerup
    if (e && e.type && (e.type.startsWith('pointer') || e.type.startsWith('mouse') || e.type.startsWith('touch'))) {
        if (e.pointerId !== undefined && typeof pttBtn.setPointerCapture === 'function') {
          activePointerId = e.pointerId;
          try {
            pttBtn.setPointerCapture(activePointerId);
          } catch {
            // Some Android permission flows can throw here; ignore.
          }
        }
    }
    
    // 立即显示 UI 反馈
    recordingOverlay.style.display = 'flex';
    recordingOverlay.style.opacity = '1';
    
    const statusText = recordingOverlay.querySelector('div:last-child');
    if (!voiceRecognizer.isReady) {
        statusText.textContent = "Loading Model...";
      setVoiceModelStatus('Loading…');
    } else {
        statusText.textContent = "Recording...";
      setVoiceModelStatus('Voice: Ready');
    }
    
    try {
      startPromise = (async () => {
        if (!voiceRecognizer.isReady) {
          await voiceRecognizer.init();
          setVoiceModelStatus('Voice: Ready');
        }

        // If the user released while we were loading, stop immediately.
        if (!isPTTPressed || shouldStopAfterStart) {
          return;
        }

        statusText.textContent = "Recording...";
        await voiceRecognizer.start((text) => {
         if (window.DEBUG_VOICE) console.log('Voice Input Received:', text);
         
         let textToSend = text;
         if (textToSend) {
            const cleanText = textToSend.trim();
            const cleanLower = cleanText.toLowerCase();

            // Alias matching: spoken text can map to a stored alias for a command.
            // Example: alias "帮助" -> sends "/help"
            let matchedByAlias = null;
            for (const [cmd, aliases] of Object.entries(quickActionAliases || {})) {
              if (!cmd || !Array.isArray(aliases)) continue;
              const hit = aliases.find((a) => {
                const s = String(a ?? '').trim();
                if (!s) return false;
                const sl = s.toLowerCase();
                if (sl === cleanLower) return true;
                // Allow alias stored with leading slash
                if (sl.startsWith('/') && sl.slice(1) === cleanLower) return true;
                return false;
              });
              if (hit) {
                matchedByAlias = cmd;
                break;
              }
            }
            if (matchedByAlias) {
              console.log(`[Voice] Alias matched "${cleanText}" -> "${matchedByAlias}"`);
              textToSend = matchedByAlias;
            } else {
            // Intelligent Command Matching:
            // Check if the spoken text matches a known command in the drawer (ignoring the leading slash)
            // Example: User says "help" -> matches "/help" in drawer -> sends "/help"
              const matchedCmd = commandHistory.find((cmd) =>
                typeof cmd === 'string' &&
                cmd.startsWith('/') &&
              cmd.slice(1).toLowerCase() === cleanLower
              );
            if (matchedCmd) {
                console.log(`[Voice] Auto-corrected "${cleanText}" to "${matchedCmd}"`);
                textToSend = matchedCmd;
            }
            }
         }

         if (!textToSend) return;

         // If it's a slash-command, execute immediately.
         if (typeof textToSend === 'string' && textToSend.trim().startsWith('/')) {
           clearPendingVoiceBuffer();
           const cmd = textToSend.trim();
           if (wsTerm.readyState === WebSocket.OPEN) {
             // 直接发送到后端 PTY，绕过 xterm 的输入处理逻辑
             wsTerm.send(cmd + '\r');
           } else {
             term.input(cmd + '\r');
           }
           return;
         }

         // Dictation mode: append to current prompt; do not auto-enter.
         appendVoiceToTerminal(textToSend);
      }, (partial) => {
         if (partial) {
            statusText.textContent = partial; // 在遮罩层实时显示中间结果
         }
        });
      })();

      await startPromise;

      if (!isPTTPressed || shouldStopAfterStart) {
        // Released before/while starting; ensure everything is cleaned up.
        try { await voiceRecognizer.stop(); } catch { /* ignore */ }
        recordingOverlay.style.display = 'none';
        recordingOverlay.style.opacity = '0';
        pttState = 'idle';
        return;
      }

      pttState = 'recording';
    } catch (err) {
      console.error('Failed to start recording', err);
      alert('Error: ' + err.message);
      recordingOverlay.style.display = 'none';
      isPTTPressed = false;
      shouldStopAfterStart = false;
      pttState = 'idle';
    }
  };
  
  const stopRecording = async (e) => {
    const force = !!(e && e.__pttForceStop);
    if (e && e.cancelable) e.preventDefault();
    if (pttState === 'stopping') return;
    if (!isPTTPressed && pttState === 'idle') return;

    // If we have an active pointer, ignore unrelated pointer events.
    // (Except when the user taps the recording overlay to force-stop.)
    if (!force && activePointerId != null && e && e.pointerId != null && e.pointerId !== activePointerId) {
      return;
    }

    // Android: permission prompt / focus changes can trigger pointercancel during startup.
    // Don't treat that as user release.
    if (e && e.type === 'pointercancel' && pttState === 'starting') {
      if (window.DEBUG_VOICE) console.log('PTT: Ignoring pointercancel during startup');
      return;
    }
    
    if (window.DEBUG_VOICE) console.log('PTT: Stop triggered', e.type);
    isPTTPressed = false;
    if (pttState === 'starting') {
      shouldStopAfterStart = true;
    }

    // 释放指针捕获
    if (typeof pttBtn.releasePointerCapture === 'function') {
      const pointerIdToRelease = (e && e.pointerId != null) ? e.pointerId : activePointerId;
      if (pointerIdToRelease != null) {
        try { pttBtn.releasePointerCapture(pointerIdToRelease); } catch (err) {}
      }
    }
    
    recordingOverlay.style.display = 'none';
    recordingOverlay.style.opacity = '0';
    
    if (voiceRecognizer) {
      try {
        pttState = 'stopping';
        await voiceRecognizer.stop();
      } catch (err) {
        console.error('Failed to stop recording', err);
      }
    }
    pttState = 'idle';
    activePointerId = null;
    
    // 只有在非移动端（即有物理键盘或主动点击）时才自动恢复焦点
    if (!isCoarsePointerDevice()) {
      term.focus();
    }
  };

  const forceStopRecordingFromOverlay = async (ev) => {
    if (ev && ev.cancelable) ev.preventDefault();
    if (ev) ev.stopPropagation();

    // Mark as force-stop so stopRecording bypasses pointerId filtering.
    if (ev) ev.__pttForceStop = true;
    await stopRecording(ev);
  };
  
  // Keyboard PTT (Right Alt / Option)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'AltRight') {
      if (e.repeat) return; // Ignore repeat events when holding down
      e.preventDefault();
      startRecording(e);
    }
  }, { capture: true });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'AltRight') {
      e.preventDefault();
      stopRecording(e);
    }
  }, { capture: true });

  // Mouse PTT (Middle Button)
  window.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      startRecording(e);
    }
  }, { capture: true });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      stopRecording(e);
    }
  }, { capture: true });

  // Use Pointer Events for unified Mouse/Touch handling
  if (window.PointerEvent) {
    pttBtn.addEventListener('pointerdown', startRecording, { passive: false });
    pttBtn.addEventListener('pointerup', stopRecording, { passive: false });
    pttBtn.addEventListener('pointercancel', stopRecording, { passive: false });

    // Clicking/tapping the overlay should always stop recording.
    if (recordingOverlay) {
      recordingOverlay.addEventListener('pointerdown', forceStopRecordingFromOverlay, { passive: false });
      recordingOverlay.addEventListener('click', forceStopRecordingFromOverlay, { passive: false });
    }

    // Ensure we still stop if the pointerup happens outside the button.
    window.addEventListener('pointerup', stopRecording, { passive: false, capture: true });
    
    // 禁用右键/长按菜单，防止移动端弹出系统菜单
    pttBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true });
  } else {
    // Fallback for older browsers
    pttBtn.addEventListener('touchstart', startRecording);
    pttBtn.addEventListener('touchend', stopRecording);
    pttBtn.addEventListener('mousedown', startRecording);
    pttBtn.addEventListener('mouseup', stopRecording);
  }
}

