(() => {
  const G = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
  const DEFAULT_BASE_URL = '/models/SenseVoiceSmall';
  const DEFAULT_MODEL_FILE = 'model_quant.onnx';
  const DEFAULT_TOKENS_FILE = 'tokens.json';
  const DEFAULT_MVN_FILE = 'am.mvn';
  const MODEL_CACHE_NAME = 'voicecode-sensevoice-model-cache-v1';

  function sleep0() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function isCacheStorageAvailable() {
    return typeof caches !== 'undefined' && typeof caches.open === 'function';
  }

  function isWebGPUAvailable() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
  }

  function resampleLinearMono(input, inputSampleRate, targetSampleRate) {
    if (inputSampleRate === targetSampleRate) return input;
    const ratio = targetSampleRate / inputSampleRate;
    const outLength = Math.max(1, Math.floor(input.length * ratio));
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIndex = i / ratio;
      const i0 = Math.floor(srcIndex);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const t = srcIndex - i0;
      output[i] = input[i0] * (1 - t) + input[i1] * t;
    }
    return output;
  }

  function validateModelArrayBuffer(buf, contentType = '') {
    const ct = String(contentType || '').toLowerCase();
    if (buf.byteLength < 1024 * 64) {
      // ONNX model should be much larger; tiny response is almost certainly an error page.
      const asText = new TextDecoder().decode(new Uint8Array(buf.slice(0, Math.min(buf.byteLength, 256))));
      if (asText.includes('git-lfs.github.com/spec/v1')) {
        throw new Error(
          'Model file is a Git LFS pointer, not the real ONNX binary. ' +
            'Run `git lfs pull` in the repo (or replace model_quant.onnx with the actual ~230MB file), then reload.'
        );
      }
      throw new Error(`Model response too small (${buf.byteLength} bytes). content-type=${ct} head=${JSON.stringify(asText)}`);
    }
    // Quick HTML detection to prevent feeding error pages to ORT.
    if (ct.includes('text/html')) {
      const asText = new TextDecoder().decode(new Uint8Array(buf.slice(0, 256)));
      throw new Error(`Model response is HTML. head=${JSON.stringify(asText)}`);
    }
    const headStr = new TextDecoder().decode(new Uint8Array(buf.slice(0, 16)));
    if (headStr.startsWith('<!DOCTYPE') || headStr.startsWith('<html') || headStr.startsWith('<!doctype')) {
      throw new Error('Model response looks like HTML (doctype/html)');
    }
    return new Uint8Array(buf);
  }

  async function loadModelBytesCachedOnce(modelUrl) {
    const cacheKey = new Request(modelUrl, { credentials: 'same-origin' });

    if (isCacheStorageAvailable()) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const ct = (cached.headers.get('content-type') || '').toLowerCase();
          const buf = await cached.arrayBuffer();
          try {
            return { bytes: validateModelArrayBuffer(buf, ct), source: 'cache' };
          } catch {
            // Cached entry is corrupted or an error page; delete and fall through to network.
            await cache.delete(cacheKey);
          }
        }
      } catch {
        // Ignore cache read errors; fall back to network.
      }
    }

    // Fetch once, then persist into CacheStorage for future loads.
    const res = await fetch(cacheKey, { cache: 'reload' });
    if (!res.ok) {
      throw new Error(`Failed to fetch model (${res.status})`);
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const resClone = res.clone();
    const buf = await resClone.arrayBuffer();
    const bytes = validateModelArrayBuffer(buf, ct);

    if (isCacheStorageAvailable()) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        await cache.put(cacheKey, res);
      } catch {
        // Quota / cache errors: still return bytes; just won't persist.
      }
    }

    return { bytes, source: 'network' };
  }

  async function loadJsonCachedOnce(url) {
    const cacheKey = new Request(url, { credentials: 'same-origin' });

    if (isCacheStorageAvailable()) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached && cached.ok) {
          try {
            return { value: await cached.json(), source: 'cache' };
          } catch {
            await cache.delete(cacheKey);
          }
        }
      } catch {
        // Ignore cache read errors; fall back to network.
      }
    }

    const res = await fetch(cacheKey, { cache: 'reload' });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    const resClone = res.clone();
    const value = await resClone.json();
    if (isCacheStorageAvailable()) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        await cache.put(cacheKey, res);
      } catch {
        // Ignore cache write errors.
      }
    }
    return { value, source: 'network' };
  }

  async function loadTextCachedOnce(url) {
    const cacheKey = new Request(url, { credentials: 'same-origin' });

    if (isCacheStorageAvailable()) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached && cached.ok) {
          try {
            return { value: await cached.text(), source: 'cache' };
          } catch {
            await cache.delete(cacheKey);
          }
        }
      } catch {
        // Ignore cache read errors; fall back to network.
      }
    }

    const res = await fetch(cacheKey, { cache: 'reload' });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    const resClone = res.clone();
    const value = await resClone.text();
    if (isCacheStorageAvailable()) {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        await cache.put(cacheKey, res);
      } catch {
        // Ignore cache write errors.
      }
    }
    return { value, source: 'network' };
  }

  function hammingWindow(N) {
    const w = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      w[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1));
    }
    return w;
  }

  function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }

  function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  function createMelFilterbank({
    sampleRate,
    nFft,
    nMels,
    fMin = 0,
    fMax = sampleRate / 2,
  }) {
    const nFftBins = Math.floor(nFft / 2) + 1;
    const melMin = hzToMel(fMin);
    const melMax = hzToMel(fMax);
    const melPoints = new Float32Array(nMels + 2);
    for (let i = 0; i < nMels + 2; i++) {
      melPoints[i] = melMin + ((melMax - melMin) * i) / (nMels + 1);
    }
    const hzPoints = Array.from(melPoints, melToHz);
    const bin = hzPoints.map((hz) => Math.floor(((nFft + 1) * hz) / sampleRate));

    const filters = new Array(nMels);
    for (let m = 0; m < nMels; m++) {
      const fbank = new Float32Array(nFftBins);
      const left = bin[m];
      const center = bin[m + 1];
      const right = bin[m + 2];

      for (let k = left; k < center; k++) {
        if (k >= 0 && k < nFftBins) fbank[k] = (k - left) / Math.max(1, center - left);
      }
      for (let k = center; k < right; k++) {
        if (k >= 0 && k < nFftBins) fbank[k] = (right - k) / Math.max(1, right - center);
      }
      filters[m] = fbank;
    }
    return filters;
  }

  class FFT512 {
    constructor() {
      this.N = 512;
      this.cos = new Float32Array(this.N / 2);
      this.sin = new Float32Array(this.N / 2);
      for (let i = 0; i < this.N / 2; i++) {
        const angle = (-2 * Math.PI * i) / this.N;
        this.cos[i] = Math.cos(angle);
        this.sin[i] = Math.sin(angle);
      }
    }

    // In-place radix-2 FFT on real input, outputs complex arrays.
    // inputReal length N. returns { real, imag }
    fftReal(inputReal) {
      const N = this.N;
      const real = new Float32Array(N);
      const imag = new Float32Array(N);
      real.set(inputReal);

      // Bit reversal
      let j = 0;
      for (let i = 1; i < N; i++) {
        let bit = N >> 1;
        while (j & bit) {
          j ^= bit;
          bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
          const tr = real[i];
          real[i] = real[j];
          real[j] = tr;
        }
      }

      // Cooley-Tukey
      for (let len = 2; len <= N; len <<= 1) {
        const half = len >> 1;
        const step = N / len;
        for (let i = 0; i < N; i += len) {
          for (let k = 0; k < half; k++) {
            const twIndex = (k * step) | 0;
            const wr = this.cos[twIndex];
            const wi = this.sin[twIndex];
            const evenR = real[i + k];
            const evenI = imag[i + k];
            const oddR = real[i + k + half];
            const oddI = imag[i + k + half];

            const tr = wr * oddR - wi * oddI;
            const ti = wr * oddI + wi * oddR;
            real[i + k] = evenR + tr;
            imag[i + k] = evenI + ti;
            real[i + k + half] = evenR - tr;
            imag[i + k + half] = evenI - ti;
          }
        }
      }

      return { real, imag };
    }
  }

  function extractCmvnFromMvnText(mvnText) {
    function extract(tag) {
      const re = new RegExp(`<${tag}>[\\s\\S]*?<LearnRateCoef>\\s*0\\s*\\[([^\\]]+)\\]`);
      const m = mvnText.match(re);
      if (!m) throw new Error(`Failed to parse ${tag} from MVN`);
      const arr = m[1].trim().split(/\s+/).map(Number);
      return new Float32Array(arr);
    }
    const shift = extract('AddShift');
    const scale = extract('Rescale');
    if (shift.length !== 560 || scale.length !== 560) {
      throw new Error(`Unexpected CMVN length shift=${shift.length} scale=${scale.length}`);
    }
    return { shift, scale };
  }

  function computeFbank80(audio16k) {
    const sampleRate = 16000;
    const frameLength = 400; // 25ms
    const frameShift = 160; // 10ms
    const nFft = 512;
    const nMels = 80;
    const eps = 1e-10;

    const window = hammingWindow(frameLength);
    const fft = new FFT512();
    const melFilters = createMelFilterbank({ sampleRate, nFft, nMels });
    const nFrames = Math.max(0, Math.floor((audio16k.length - frameLength) / frameShift) + 1);

    const power = new Float32Array(Math.floor(nFft / 2) + 1);
    const frame = new Float32Array(nFft);
    const feats = new Array(nFrames);

    for (let t = 0; t < nFrames; t++) {
      const start = t * frameShift;
      frame.fill(0);
      for (let i = 0; i < frameLength; i++) {
        frame[i] = audio16k[start + i] * window[i];
      }
      const { real, imag } = fft.fftReal(frame);
      for (let k = 0; k < power.length; k++) {
        const r = real[k];
        const im = imag[k];
        power[k] = r * r + im * im;
      }
      const mel = new Float32Array(nMels);
      for (let m = 0; m < nMels; m++) {
        const w = melFilters[m];
        let sum = 0;
        for (let k = 0; k < power.length; k++) sum += power[k] * w[k];
        mel[m] = Math.log(Math.max(eps, sum));
      }
      feats[t] = mel;
    }
    return feats;
  }

  function applyLfr(feats80, lfrM = 7, lfrN = 6) {
    const T = feats80.length;
    if (T === 0) return new Float32Array(0);
    const outT = Math.ceil(T / lfrN);
    const out = new Float32Array(outT * 560);

    for (let i = 0; i < outT; i++) {
      const start = i * lfrN;
      for (let m = 0; m < lfrM; m++) {
        const srcIndex = clamp(start + m, 0, T - 1);
        out.set(feats80[srcIndex], i * 560 + m * 80);
      }
    }
    return out;
  }

  function applyCmvn560(lfrFeatures, cmvn) {
    const { shift, scale } = cmvn;
    const out = new Float32Array(lfrFeatures.length);
    for (let i = 0; i < lfrFeatures.length; i++) {
      const j = i % 560;
      out[i] = (lfrFeatures[i] + shift[j]) * scale[j];
    }
    return out;
  }

  function argmaxRow(data, rowOffset, rowLen) {
    let maxVal = data[rowOffset];
    let maxIdx = 0;
    for (let i = 1; i < rowLen; i++) {
      const v = data[rowOffset + i];
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }
    return maxIdx;
  }

  function decodeCtcGreedy(logits, dims, tokens, blankId = 0) {
    const [B, T, V] = dims;
    if (B !== 1) throw new Error(`Only batch=1 supported, got ${B}`);
    const outIds = [];
    let prev = -1;
    for (let t = 0; t < T; t++) {
      const idx = argmaxRow(logits, t * V, V);
      if (idx !== blankId && idx !== prev) outIds.push(idx);
      prev = idx;
    }
    const pieces = [];
    for (const id of outIds) {
      const tok = tokens[id];
      if (!tok) continue;
      if (tok === '<unk>' || tok === '<s>' || tok === '</s>') continue;
      pieces.push(tok);
    }
    // SentencePiece-like tokens: ▁ indicates word boundary
    return pieces.join('').replaceAll('▁', ' ').trim();
  }

  function cleanTranscript(text) {
    if (!text) return '';
    return text
      .replace(/<\|[^>]+\|>/g, ' ')
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  class SenseVoiceProcessor {
    constructor({ baseUrl = DEFAULT_BASE_URL } = {}) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
      this.session = null;
      this.tokens = null;
      this.cmvn = null;
      this.isReady = false;

      this._runChain = Promise.resolve();

      this._debug = !!(G && G.DEBUG_VOICE);
    }

    _log(...args) {
      if (this._debug) console.log(...args);
    }

    static decodeCtcGreedy(logits, dims, tokens, blankId = 0) {
      return decodeCtcGreedy(logits, dims, tokens, blankId);
    }

    static cleanTranscript(text) {
      return cleanTranscript(text);
    }

    async init({ preferWebGPU = true } = {}) {
      if (this.isReady) return;
      if (!G.ort) throw new Error('ONNX Runtime (ort) not loaded');

      // Conservative defaults for mobile stability.
      try {
        if (G.ort?.env?.wasm) {
          if (typeof G.ort.env.wasm.numThreads === 'number') {
            G.ort.env.wasm.numThreads = 1;
          }
          const chosen = (G && G.__ORT_WASM_BASE__) ? String(G.__ORT_WASM_BASE__) : '';
          G.ort.env.wasm.wasmPaths = chosen || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
        }
      } catch {
        // ignore env config failures
      }

      // Load assets in parallel (cached once in CacheStorage)
      const tokensUrl = `${this.baseUrl}/${DEFAULT_TOKENS_FILE}`;
      const mvnUrl = `${this.baseUrl}/${DEFAULT_MVN_FILE}`;
      const [{ value: tokens }, { value: mvnText }] = await Promise.all([
        loadJsonCachedOnce(tokensUrl),
        loadTextCachedOnce(mvnUrl),
      ]);
      this.tokens = tokens;
      this.cmvn = extractCmvnFromMvnText(mvnText);

      const modelUrl = `${this.baseUrl}/${DEFAULT_MODEL_FILE}`;
      const providers = [];
      if (preferWebGPU && isWebGPUAvailable()) providers.push('webgpu');
      providers.push('wasm');

      const createSession = async (executionProviders, modelBytes) => {
        return await G.ort.InferenceSession.create(modelBytes, {
          executionProviders,
        });
      };

      // Fetch only once (when cache is empty), then reuse CacheStorage on next loads.
      const { bytes: modelBytes, source: modelSource } = await loadModelBytesCachedOnce(modelUrl);

      try {
        this.session = await createSession(providers, modelBytes);
      } catch (e) {
        // Fallback to WASM if WebGPU init failed.
        try {
          this.session = await createSession(['wasm'], modelBytes);
        } catch (e2) {
          const msg = String((e2 && (e2.message || e2)) || e2);
          if (modelSource === 'cache') {
            throw new Error(
              `Failed to initialize model from cached bytes. Try clearing the Voice Model Cache in Settings and reload. Original error: ${msg}`
            );
          }
          throw e2;
        }
      }

      this.isReady = true;
    }

    async transcribe(float32Audio, sampleRate, { language = 0, textnorm = 0 } = {}) {
      // ORT WASM sessions are not re-entrant; queue transcribe calls.
      const run = async () => {
        if (!this.isReady) await this.init();

        const audio16k = resampleLinearMono(float32Audio, sampleRate, 16000);
        // Too short: ignore
        if (audio16k.length < 1600) return '';

        // Feature extraction can be heavy; yield once so UI stays responsive.
        await sleep0();
        const feats80 = computeFbank80(audio16k);
        const lfr = applyLfr(feats80, 7, 6);
        const norm = applyCmvn560(lfr, this.cmvn);
        const T = Math.floor(norm.length / 560);
        if (T <= 0) return '';

        const ort = G.ort;
        const feeds = {
          speech: new ort.Tensor('float32', norm, [1, T, 560]),
          speech_lengths: new ort.Tensor('int32', Int32Array.from([T]), [1]),
          language: new ort.Tensor('int32', Int32Array.from([language]), [1]),
          textnorm: new ort.Tensor('int32', Int32Array.from([textnorm]), [1]),
        };

        const out = await this.session.run(feeds);
        const logits = out.ctc_logits;
        if (!logits || !logits.data) return '';

        const decoded = decodeCtcGreedy(logits.data, logits.dims, this.tokens, 0);
        return cleanTranscript(decoded);
      };

      this._runChain = this._runChain.then(run, run);
      return await this._runChain;
    }
  }

  SenseVoiceProcessor.MODEL_CACHE_NAME = MODEL_CACHE_NAME;
  G.SenseVoiceProcessor = SenseVoiceProcessor;
})();
