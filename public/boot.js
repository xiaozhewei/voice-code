(() => {
  const REQUIRED_SCRIPTS_IN_ORDER = [
    '/audio-capture.js',
    '/sense-voice-processor.js',
    '/voice-recognizer.js',
    '/terminal-logic.js',
    '/main.js',
  ];

  const WARM_URLS = [
    // Xterm (CDN)
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.css',
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/lib/xterm.js',
    'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.js',
    'https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.12.0/lib/addon-web-links.js',
    'https://cdn.jsdelivr.net/npm/@xterm/addon-webgl@0.19.0/lib/addon-webgl.js',
    // ORT runtime (CDN)
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.js',
    // App shell
    '/boot.js',
    '/audio-capture.js',
    '/sense-voice-processor.js',
    '/sense-voice-worker.js',
    '/voice-recognizer.js',
    '/terminal-logic.js',
    '/main.js',
  ];

  function loadScriptSequential(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.body.appendChild(s);
    });
  }

  async function fetchManifest() {
    try {
      const res = await fetch('/assets-manifest.json', { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || typeof json !== 'object') return null;
      return json;
    } catch {
      return null;
    }
  }

  function withVersion(path, manifest) {
    if (!manifest) return path;
    const v = manifest[path];
    if (!v) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}v=${encodeURIComponent(v)}`;
  }

  async function registerServiceWorkerIfPossible(swUrl) {
    try {
      if (!('serviceWorker' in navigator)) return;

      // Register ASAP (do not wait for window load) so SW can activate/claim quickly.
      const reg = await navigator.serviceWorker.register(swUrl);
      return reg;
    } catch {
      // ignore
    }
  }

  async function warmCacheIfPossible(reg, urls) {
    try {
      if (!reg) return;
      const sw = reg.active || reg.waiting || reg.installing;
      if (sw) {
        sw.postMessage({ type: 'WARM_CACHE', urls });
        return;
      }
      const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (ctrl) ctrl.postMessage({ type: 'WARM_CACHE', urls });
    } catch {
      // ignore
    }
  }

  async function waitForController(timeoutMs = 1500) {
    if (!('serviceWorker' in navigator)) return;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve();
      }, timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  (async () => {
    const manifest = await fetchManifest();
    if (manifest) {
      window.__ASSET_MANIFEST__ = manifest;
      if (manifest.__hash) {
        try { localStorage.setItem('assetManifestHash', String(manifest.__hash)); } catch { /* ignore */ }
      }
    }

    // Register SW as early as possible.
    const swUrl = withVersion('/sw.js', manifest);
    const reg = await registerServiceWorkerIfPossible(swUrl);

    // Warm SW cache with versioned URLs (if we have a manifest).
    const warmUrls = manifest
      ? WARM_URLS.map((u) => (u.startsWith('/') ? withVersion(u, manifest) : u))
      : WARM_URLS;

    warmCacheIfPossible(reg, warmUrls);

    // Best-effort: allow SW to claim this page before we start loading lots of JS.
    // This increases the chance the first load is already served by SW cache.
    await waitForController(1200);

    // Load app scripts in order, using manifest versions to force refresh when changed.
    for (const path of REQUIRED_SCRIPTS_IN_ORDER) {
      const src = withVersion(path, manifest);
      await loadScriptSequential(src);
    }
  })().catch((err) => {
    // Last-resort: show something in console; UI will still load partially.
    console.error('[boot] failed to start app:', err);
  });
})();
