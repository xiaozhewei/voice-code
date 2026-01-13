/* Service Worker for caching large local model assets (SenseVoiceSmall) and runtime files.
   Goal: reduce repeated model load time across page reloads.
*/

const CACHE_VERSION = 'v2';
const CACHE_NAME = `voicecode-cache-${CACHE_VERSION}`;

const ORT_CDN_BASES = [
  'https://cdn.jsdmirror.com/npm/onnxruntime-web@1.20.1/dist',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist',
  'https://fastly.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist',
  'https://gcore.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist',
  'https://unpkg.com/onnxruntime-web@1.20.1/dist',
];

const XTERM_CDN_PREFIXES = [
  'https://cdn.jsdmirror.com/npm/@xterm/',
  'https://cdn.jsdelivr.net/npm/@xterm/',
  'https://fastly.jsdelivr.net/npm/@xterm/',
  'https://gcore.jsdelivr.net/npm/@xterm/',
  'https://unpkg.com/@xterm/',
];
const MODELS_BASE = 'https://modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master';

// Assets to cache
const ASSETS_TO_CACHE = [
  // Xterm (CDN)
  `${XTERM_CDN_PREFIXES[0]}xterm@6.0.0/css/xterm.css`,
  `${XTERM_CDN_PREFIXES[0]}xterm@6.0.0/lib/xterm.js`,
  `${XTERM_CDN_PREFIXES[0]}addon-fit@0.11.0/lib/addon-fit.js`,
  `${XTERM_CDN_PREFIXES[0]}addon-web-links@0.12.0/lib/addon-web-links.js`,
  `${XTERM_CDN_PREFIXES[0]}addon-webgl@0.19.0/lib/addon-webgl.js`,
  // ORT runtime (CDN)
  `${ORT_CDN_BASES[0]}/ort.all.min.js`,
  `${ORT_CDN_BASES[0]}/ort-wasm-simd-threaded.jsep.wasm`,
  `${ORT_CDN_BASES[0]}/ort-wasm-simd-threaded.jsep.mjs`,
  `${ORT_CDN_BASES[0]}/ort-wasm-simd-threaded.wasm`,
  `${ORT_CDN_BASES[0]}/ort-wasm-simd-threaded.mjs`,
];

// Same-origin app shell assets worth caching (fast reload on mobile).
// Keep this list focused to avoid stale navigation issues.
const APP_SHELL_TO_CACHE = [
  '/boot.js',
  '/audio-capture.js',
  '/sense-voice-processor.js',
  '/sense-voice-worker.js',
  '/voice-recognizer.js',
  '/terminal-logic.js',
  '/main.js',
];

function isCacheableRequest(requestUrl) {
  try {
    const url = new URL(requestUrl);
    // Large model file: let browser handle it or avoid filling SW cache
    if (url.pathname.endsWith('.onnx')) return false;
    
    // Cache ORT runtime files (multiple CDNs)
    if (ORT_CDN_BASES.some((b) => url.href.startsWith(b))) return true;

    // Cache xterm CDN assets (multiple CDNs)
    if (XTERM_CDN_PREFIXES.some((p) => url.href.startsWith(p))) return true;

    // Do not cache model assets from ModelScope here.
    // SenseVoiceProcessor caches them in a dedicated CacheStorage that the UI can clear.
    if (url.href.startsWith(MODELS_BASE)) return false;

    // Cache same-origin JS/CSS assets (xterm + app shell)
    if (url.origin === self.location.origin) {
      if (url.pathname.startsWith('/themes/') && url.pathname.endsWith('.json')) return true;
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isImmutableRequest(requestUrl) {
  try {
    const url = new URL(requestUrl);
    // Versioned local assets (boot adds ?v=hash) are immutable.
    if (url.searchParams.has('v')) return true;
    // CDN libraries are versioned in path.
    if (ORT_CDN_BASES.some((b) => url.href.startsWith(b)) || XTERM_CDN_PREFIXES.some((p) => url.href.startsWith(p))) return true;
    return false;
  } catch {
    return false;
  }
}

async function cachePutSafe(cache, request, response) {
  // Avoid caching opaque or error responses.
  if (!response || !response.ok || response.type === 'opaque') return;
  try {
    await cache.put(request, response);
  } catch {
    // Quota errors can happen on mobile. If caching fails, we still allow network.
  }
}

async function warmCache(urls) {
  const cache = await caches.open(CACHE_NAME);
  for (const url of urls) {
    try {
      const abs = new URL(url, self.location.origin).toString();
      const u = new URL(abs);
      const sameOrigin = u.origin === self.location.origin;
      const req = new Request(abs, {
        cache: 'reload',
        mode: sameOrigin ? 'same-origin' : 'cors',
        credentials: sameOrigin ? 'same-origin' : 'omit',
      });
      const existing = await cache.match(req);
      if (existing) continue;
      const res = await fetch(req);
      await cachePutSafe(cache, req, res.clone());
    } catch {
      // Ignore individual warm failures.
    }
  }
}

self.addEventListener('install', (event) => {
  // Activate immediately so first load can warm cache quickly.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean old caches
      const keys = await caches.keys();
      return Promise.all(
        keys.map((k) => {
          if (k.startsWith('voicecode-cache-') && k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
      
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'WARM_CACHE') {
    const urls = Array.isArray(data.urls) ? data.urls : [...ASSETS_TO_CACHE, ...APP_SHELL_TO_CACHE];
    event.waitUntil(warmCache(urls));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (!isCacheableRequest(req.url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        // Cache-first for immutable/versioned assets to avoid noisy network.
        if (!isImmutableRequest(req.url)) {
          // Stale-while-revalidate for non-versioned assets.
          event.waitUntil(
            (async () => {
              try {
                const res = await fetch(req);
                await cachePutSafe(cache, req, res.clone());
              } catch {
                // ignore refresh failures
              }
            })()
          );
        }
        return cached;
      }
      const res = await fetch(req);
      await cachePutSafe(cache, req, res.clone());
      return res;
    })()
  );
});