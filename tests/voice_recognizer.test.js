const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('VoiceRecognizer', () => {
  let context;

  beforeEach(() => {
    const sandbox = {
      window: {},
      Worker: undefined,
      console: console,
      Promise: Promise,
      AudioCapture: class {
        async start() {
          return {
            audioContext: { 
              sampleRate: 16000,
              createScriptProcessor: jest.fn().mockReturnValue({
                connect: jest.fn(),
                disconnect: jest.fn(),
                onaudioprocess: null
              }),
              destination: {},
              createGain: jest.fn().mockReturnValue({
                gain: { value: 0 },
                connect: jest.fn()
              }),
            },
            source: { connect: jest.fn() }
          };
        }
        stop() {}
      },
      SenseVoiceProcessor: class {
        constructor() {
          this.isReady = false;
        }
        async init() {
          this.isReady = true;
        }
        async transcribe() {
          return 'hello world';
        }
      },
      URL: {
        createObjectURL: jest.fn().mockReturnValue('blob:url')
      }
    };
    sandbox.window = sandbox;
    context = vm.createContext(sandbox);

    const scriptContent = fs.readFileSync(path.join(__dirname, '../public/voice-recognizer.js'), 'utf8');
    vm.runInContext(scriptContent, context);
  });

  it('should be defined', () => {
    expect(context.VoiceRecognizer).toBeDefined();
  });

  it('should initialize and load model', async () => {
    const recognizer = vm.runInContext('new VoiceRecognizer()', context);
    await recognizer.init();
    expect(recognizer.isReady).toBe(true);
  });

  it('should start recognition', async () => {
    const recognizer = vm.runInContext('new VoiceRecognizer()', context);
    await recognizer.init();
    await recognizer.start(jest.fn(), jest.fn());
    await recognizer.stop();
  });
});
