/* Web Worker for SenseVoiceSmall inference.
   Offloads model initialization and inference from the main thread.
*/

/* global importScripts */

let processor = null;

const ORT_CDN_SOURCES = [
  'https://cdn.jsdmirror.com/npm/onnxruntime-web@1.20.1/dist/ort.all.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.js',
  'https://fastly.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.js',
  'https://gcore.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.js',
  'https://unpkg.com/onnxruntime-web@1.20.1/dist/ort.all.min.js',
];

const ORT_WASM_BASES = [
  'https://cdn.jsdmirror.com/npm/onnxruntime-web@1.20.1/dist/',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
  'https://fastly.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
  'https://gcore.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
  'https://unpkg.com/onnxruntime-web@1.20.1/dist/',
];

function importScriptsWithFallback(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      importScripts(url);
      return url;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('importScripts failed');
}

function postOk(id, result) {
  self.postMessage({ id, ok: true, result });
}

function postErr(id, error) {
  const message = error && error.message ? error.message : String(error);
  self.postMessage({ id, ok: false, error: message });
}

async function ensureLoaded() {
  if (processor) return;
  // Load runtime + processor code.
  const chosenOrt = importScriptsWithFallback(ORT_CDN_SOURCES);
  importScripts('/sense-voice-processor.js');
  if (!self.SenseVoiceProcessor) throw new Error('SenseVoiceProcessor not available in worker');

  // Help SenseVoiceProcessor pick a working wasm base.
  try {
    const idx = ORT_CDN_SOURCES.indexOf(chosenOrt);
    self.__ORT_WASM_BASE__ = ORT_WASM_BASES[Math.max(0, idx)] || ORT_WASM_BASES[0];
  } catch {
    // ignore
  }

  processor = new self.SenseVoiceProcessor({ baseUrl: 'https://modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master' });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  const { id, type } = data;

  try {
    if (type === 'INIT') {
      await ensureLoaded();
      await processor.init({ preferWebGPU: false });
      postOk(id, true);
      return;
    }

    if (type === 'TRANSCRIBE') {
      await ensureLoaded();
      if (!processor.isReady) await processor.init({ preferWebGPU: false });
      const audio = data.audio;
      const sampleRate = data.sampleRate;
      const language = data.language ?? 0;
      const textnorm = data.textnorm ?? 0;
      const text = await processor.transcribe(audio, sampleRate, { language, textnorm });
      postOk(id, text);
      return;
    }

    postErr(id, new Error(`Unknown message type: ${type}`));
  } catch (e) {
    postErr(id, e);
  }
};
