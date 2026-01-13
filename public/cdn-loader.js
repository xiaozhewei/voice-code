(() => {
  // Loads required third-party assets with CDN fallback.
  // Exposes:
  // - window.__CDN_CHOSEN__ = { kind: 'jsdelivr'|'unpkg'|..., base: string }
  // - window.__ORT_WASM_BASE__ = string

  const XTERM_VERSION = '6.0.0';
  const FIT_VERSION = '0.11.0';
  const WEBLINKS_VERSION = '0.12.0';
  const WEBGL_VERSION = '0.19.0';
  const ORT_VERSION = '1.20.1';

  const SOURCES = [
    {
      name: 'jsdmirror',
      base: 'https://cdn.jsdmirror.com/npm',
      xtermCss: `https://cdn.jsdmirror.com/npm/@xterm/xterm@${XTERM_VERSION}/css/xterm.css`,
      xtermJs: `https://cdn.jsdmirror.com/npm/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js`,
      fitJs: `https://cdn.jsdmirror.com/npm/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js`,
      weblinksJs: `https://cdn.jsdmirror.com/npm/@xterm/addon-web-links@${WEBLINKS_VERSION}/lib/addon-web-links.js`,
      webglJs: `https://cdn.jsdmirror.com/npm/@xterm/addon-webgl@${WEBGL_VERSION}/lib/addon-webgl.js`,
      ortJs: `https://cdn.jsdmirror.com/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.js`,
      ortWasmBase: `https://cdn.jsdmirror.com/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
    },
    {
      name: 'jsdelivr',
      base: 'https://cdn.jsdelivr.net/npm',
      xtermCss: `https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/css/xterm.css`,
      xtermJs: `https://cdn.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js`,
      fitJs: `https://cdn.jsdelivr.net/npm/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js`,
      weblinksJs: `https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@${WEBLINKS_VERSION}/lib/addon-web-links.js`,
      webglJs: `https://cdn.jsdelivr.net/npm/@xterm/addon-webgl@${WEBGL_VERSION}/lib/addon-webgl.js`,
      ortJs: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.js`,
      ortWasmBase: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
    },
    {
      name: 'jsdelivr-fastly',
      base: 'https://fastly.jsdelivr.net/npm',
      xtermCss: `https://fastly.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/css/xterm.css`,
      xtermJs: `https://fastly.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js`,
      fitJs: `https://fastly.jsdelivr.net/npm/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js`,
      weblinksJs: `https://fastly.jsdelivr.net/npm/@xterm/addon-web-links@${WEBLINKS_VERSION}/lib/addon-web-links.js`,
      webglJs: `https://fastly.jsdelivr.net/npm/@xterm/addon-webgl@${WEBGL_VERSION}/lib/addon-webgl.js`,
      ortJs: `https://fastly.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.js`,
      ortWasmBase: `https://fastly.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
    },
    {
      name: 'jsdelivr-gcore',
      base: 'https://gcore.jsdelivr.net/npm',
      xtermCss: `https://gcore.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/css/xterm.css`,
      xtermJs: `https://gcore.jsdelivr.net/npm/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js`,
      fitJs: `https://gcore.jsdelivr.net/npm/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js`,
      weblinksJs: `https://gcore.jsdelivr.net/npm/@xterm/addon-web-links@${WEBLINKS_VERSION}/lib/addon-web-links.js`,
      webglJs: `https://gcore.jsdelivr.net/npm/@xterm/addon-webgl@${WEBGL_VERSION}/lib/addon-webgl.js`,
      ortJs: `https://gcore.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.js`,
      ortWasmBase: `https://gcore.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
    },
    {
      name: 'unpkg',
      base: 'https://unpkg.com',
      xtermCss: `https://unpkg.com/@xterm/xterm@${XTERM_VERSION}/css/xterm.css`,
      xtermJs: `https://unpkg.com/@xterm/xterm@${XTERM_VERSION}/lib/xterm.js`,
      fitJs: `https://unpkg.com/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js`,
      weblinksJs: `https://unpkg.com/@xterm/addon-web-links@${WEBLINKS_VERSION}/lib/addon-web-links.js`,
      webglJs: `https://unpkg.com/@xterm/addon-webgl@${WEBGL_VERSION}/lib/addon-webgl.js`,
      ortJs: `https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.js`,
      ortWasmBase: `https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/`,
    },
  ];

  function loadCss(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.crossOrigin = 'anonymous';
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load css: ${href}`));
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.body.appendChild(s);
    });
  }

  async function trySource(source) {
    // Order matters: css -> xterm -> addons -> ort
    await loadCss(source.xtermCss);
    await loadScript(source.xtermJs);
    await loadScript(source.fitJs);
    await loadScript(source.weblinksJs);
    await loadScript(source.webglJs);
    await loadScript(source.ortJs);

    // Basic sanity check: xterm + ORT should exist on window.
    if (!window.Terminal || !window.ort) {
      throw new Error('Sanity check failed after loading CDN assets');
    }

    window.__CDN_CHOSEN__ = { kind: source.name, base: source.base };
    window.__ORT_WASM_BASE__ = source.ortWasmBase;
  }

  (async () => {
    for (const src of SOURCES) {
      try {
        await trySource(src);
        return;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[cdn-loader] failed, trying next source:', src.name, e);
      }
    }

    // All sources failed.
    // eslint-disable-next-line no-console
    console.error('[cdn-loader] all CDN sources failed; the app may not function');
  })();
})();
