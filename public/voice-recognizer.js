class VoiceRecognizer {
  constructor() {
    const G = typeof globalThis !== 'undefined' ? globalThis : null;

    const DEFAULT_SENSEVOICE_BASE_URL = 'https://modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master';
    this._senseVoiceBaseUrl = DEFAULT_SENSEVOICE_BASE_URL;

    this.processorEngine = null;
    this.worker = null;
    this._reqId = 1;
    this._pending = new Map();
    this.capture = new AudioCapture();
    this.isReady = false;
    this.processor = null;
    this.onResultCallback = null;
    this.onPartialResultCallback = null;

    this.audioContext = null;
    this._recordedChunks = [];
    this._recordedLength = 0;

    this._stopPromise = null;

    this._debug = !!(G && G.DEBUG_VOICE);

    // Prefer running model init/inference off the main thread.
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker('/sense-voice-worker.js');
        this.worker.onmessage = (ev) => {
          const msg = ev.data || {};
          const pending = this._pending.get(msg.id);
          if (!pending) return;
          this._pending.delete(msg.id);
          if (msg.ok) pending.resolve(msg.result);
          else pending.reject(new Error(msg.error || 'Worker error'));
        };
        this.worker.onmessageerror = (err) => {
          console.error('[VoiceRecognizer] Worker message error:', err);
        };
        this.worker.onerror = (err) => {
          console.error('[VoiceRecognizer] Worker error (likely SSL/loading issue):', err);
          try { this.worker.terminate(); } catch { /* ignore */ }
          this.worker = null;
          // If we had pending requests, reject them
          for (const [id, pending] of this._pending.entries()) {
            pending.reject(new Error('Worker failed to load'));
            this._pending.delete(id);
          }
        };
      } catch (e) {
        console.warn('[VoiceRecognizer] Failed to create Worker:', e);
        this.worker = null;
      }
    }
  }

  _log(...args) {
    if (this._debug) console.log(...args);
  }

  _callWorker(type, payload) {
    if (!this.worker) return null;
    const id = this._reqId++;
    const msg = { id, type, ...payload };
    return new Promise((resolve, reject) => {
      // Set a safety timeout for worker calls (especially INIT)
      const timeout = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error('Worker response timeout'));
          // If INIT times out, we likely have an SSL/loading issue hidden by browser
          if (type === 'INIT') {
            try { this.worker.terminate(); } catch { /* ignore */ }
            this.worker = null;
          }
        }
      }, type === 'INIT' ? 45000 : 60000);

      this._pending.set(id, { 
        resolve: (val) => { clearTimeout(timeout); resolve(val); }, 
        reject: (err) => { clearTimeout(timeout); reject(err); } 
      });

      try {
        if (payload && payload._transfer && Array.isArray(payload._transfer)) {
          const transfer = payload._transfer;
          delete msg._transfer;
          this.worker.postMessage(msg, transfer);
        } else {
          this.worker.postMessage(msg);
        }
      } catch (e) {
        clearTimeout(timeout);
        this._pending.delete(id);
        reject(e);
      }
    });
  }

  async init() {
    try {
      // If worker is available, init there to avoid blocking the main thread.
      const workerInit = this._callWorker('INIT', {});
      if (workerInit) {
        this._log('SenseVoice(worker): Loading model');
        try {
          await workerInit;
          this.isReady = true;
          this._log('SenseVoice(worker): Model loaded');
          return;
        } catch (err) {
          // Mobile can be slow or fail to load worker/wasm; fall back to main thread.
          console.warn('[VoiceRecognizer] Worker init failed; falling back to main thread:', err);
          this.worker = null;
        }
      }

      const G = typeof globalThis !== 'undefined' ? globalThis : null;
      if (!G || !G.SenseVoiceProcessor) {
        throw new Error('SenseVoiceProcessor not loaded (missing /sense-voice-processor.js?)');
      }
      this.processorEngine = new G.SenseVoiceProcessor({ baseUrl: this._senseVoiceBaseUrl });
      this._log('SenseVoice: Loading model from ModelScope');
      await this.processorEngine.init({ preferWebGPU: false });
      this.isReady = true;
      this._log('SenseVoice: Model loaded successfully');
    } catch (e) {
      console.error('SenseVoice: Failed to init model', e);
      throw e;
    }
  }

  async start(onResult, onPartialResult) {
    if (!this.isReady) throw new Error('Model not loaded');
    
    this.onResultCallback = onResult;
    this.onPartialResultCallback = onPartialResult;

    this._log('SenseVoice: Starting audio capture...');
    const { audioContext, source } = await this.capture.start();
    this._log('SenseVoice: Audio capture started, sampleRate:', audioContext.sampleRate);

    this._recordedChunks = [];
    this._recordedLength = 0;
    this.audioContext = audioContext;

    if (this.onPartialResultCallback) {
      this.onPartialResultCallback('Recording...');
    }

    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    let sampleCount = 0;

    processor.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0);
      
      if (sampleCount === 0) this._log('SenseVoice: First audio samples received by processor');
      sampleCount += channelData.length;

      // Copy out the audio frame since channelData is reused by WebAudio
      const copied = new Float32Array(channelData.length);
      copied.set(channelData);
      this._recordedChunks.push(copied);
      this._recordedLength += copied.length;
    };

    source.connect(processor);
    // 必须连接到 destination 才能触发 onaudioprocess
    if (typeof audioContext.createGain === 'function') {
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
    } else {
      // Fallback for mocked/older AudioContext
      processor.connect(audioContext.destination);
    }

    this.processor = processor;
  }

  async stop() {
    if (this._stopPromise) return this._stopPromise;

    this._stopPromise = (async () => {
    this._log('SenseVoice: Stopping...');

    await this.capture.stop();
    
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.onPartialResultCallback) {
      this.onPartialResultCallback('Transcribing...');
    }

    try {
      const buildAudio = () => {
        const audio = new Float32Array(this._recordedLength);
        let offset = 0;
        for (const chunk of this._recordedChunks) {
          audio.set(chunk, offset);
          offset += chunk.length;
        }
        return audio;
      };

      const audio = buildAudio();

      const sr = this.audioContext?.sampleRate || 48000;

      let text = '';
      const workerCall = this._callWorker('TRANSCRIBE', {
        audio,
        sampleRate: sr,
        language: 0,
        textnorm: 0,
        _transfer: [audio.buffer],
      });
      if (workerCall) {
        try {
          text = await workerCall;
        } catch (err) {
          console.warn('[VoiceRecognizer] Worker transcribe failed; falling back to main thread:', err);
          this.worker = null;
          const audio2 = buildAudio();
          const G = typeof globalThis !== 'undefined' ? globalThis : null;
          if (!this.processorEngine) {
            if (!G || !G.SenseVoiceProcessor) {
              throw new Error('SenseVoiceProcessor not loaded (missing /sense-voice-processor.js?)');
            }
            this.processorEngine = new G.SenseVoiceProcessor({ baseUrl: this._senseVoiceBaseUrl });
            await this.processorEngine.init({ preferWebGPU: false });
          } else if (!this.processorEngine.isReady && typeof this.processorEngine.init === 'function') {
            await this.processorEngine.init({ preferWebGPU: false });
          }
          text = await this.processorEngine.transcribe(audio2, sr, { language: 0, textnorm: 0 });
        }
      } else {
        const G = typeof globalThis !== 'undefined' ? globalThis : null;
        if (!this.processorEngine) {
          if (!G || !G.SenseVoiceProcessor) {
            throw new Error('SenseVoiceProcessor not loaded (missing /sense-voice-processor.js?)');
          }
          this.processorEngine = new G.SenseVoiceProcessor({ baseUrl: this._senseVoiceBaseUrl });
          await this.processorEngine.init({ preferWebGPU: false });
        } else if (!this.processorEngine.isReady && typeof this.processorEngine.init === 'function') {
          await this.processorEngine.init({ preferWebGPU: false });
        }
        text = await this.processorEngine.transcribe(audio, sr, { language: 0, textnorm: 0 });
      }
      if (text && this.onResultCallback) {
        try {
          this.onResultCallback(text);
        } catch (callbackErr) {
          console.error('[VoiceRecognizer] onResultCallback failed', callbackErr);
        }
      }
    } catch (e) {
      console.error('SenseVoice: Transcription failed', e);
      throw e;
    } finally {
      this._recordedChunks = [];
      this._recordedLength = 0;
      this.audioContext = null;
    }

    this._log('SenseVoice: Stopped');
    })();

    try {
      return await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.VoiceRecognizer = VoiceRecognizer;
} else if (typeof globalThis !== 'undefined') {
  globalThis.VoiceRecognizer = VoiceRecognizer;
}