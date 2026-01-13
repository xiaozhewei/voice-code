const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('AudioCapture', () => {
  let context;

  beforeEach(() => {
    const sandbox = {
      window: {},
      navigator: {
        mediaDevices: {
          getUserMedia: jest.fn()
        }
      },
      AudioContext: jest.fn().mockImplementation(() => ({
        createMediaStreamSource: jest.fn().mockReturnValue({
          connect: jest.fn()
        }),
        createScriptProcessor: jest.fn().mockReturnValue({
          connect: jest.fn(),
          onaudioprocess: null
        }),
        sampleRate: 48000,
        close: jest.fn()
      })),
      console: console,
      Promise: Promise
    };
    sandbox.window = sandbox;
    context = vm.createContext(sandbox);

    const scriptContent = fs.readFileSync(path.join(__dirname, '../public/audio-capture.js'), 'utf8');
    vm.runInContext(scriptContent, context);
  });

  it('should be defined', () => {
    expect(context.AudioCapture).toBeDefined();
  });

  it('should start capture', async () => {
    const capture = vm.runInContext('new AudioCapture()', context);
    context.navigator.mediaDevices.getUserMedia.mockResolvedValue('stream');
    
    await capture.start();
    
    expect(context.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: false,
      audio: expect.objectContaining({
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1
      })
    });
  });
});
