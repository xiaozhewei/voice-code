class AudioCapture {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
  }

  async start() {
    try {
      // 检查是否支持 getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser does not support audio capture (getUserMedia). Check HTTPS?");
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          // Avoid forcing sampleRate; some browsers/devices ignore or reject it.
        }
      });
      
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("AudioContext not supported");

      // Let the browser pick a supported sample rate; we pass the real sampleRate to Vosk.
      this.audioContext = new AudioContextClass();
      
      // 关键修复：确保 AudioContext 处于 running 状态
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(this.stream);
      
      return { stream: this.stream, audioContext: this.audioContext, source };
    } catch (e) {
      console.error('Audio capture failed', e);
      throw e;
    }
  }

  async stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch (e) {
        // Some browsers may throw if already closed; ignore.
      }
    }
    this.stream = null;
    this.audioContext = null;
  }
}

window.AudioCapture = AudioCapture;
