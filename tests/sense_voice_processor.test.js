const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('SenseVoiceProcessor (unit)', () => {
  let context;

  beforeEach(() => {
    const sandbox = {
      window: {},
      console,
      fetch: jest.fn(),
      navigator: {},
      setTimeout,
    };
    sandbox.window = sandbox;
    context = vm.createContext(sandbox);

    const scriptContent = fs.readFileSync(
      path.join(__dirname, '../public/sense-voice-processor.js'),
      'utf8'
    );
    vm.runInContext(scriptContent, context);
  });

  it('should expose SenseVoiceProcessor', () => {
    expect(context.SenseVoiceProcessor).toBeDefined();
  });

  it('should clean rich tags and brackets', () => {
    const cleaned = vm.runInContext(
      "SenseVoiceProcessor.cleanTranscript('ls <|zh|> <|HAPPY|> [COUGH] -la')",
      context
    );
    expect(cleaned).toBe('ls -la');
  });

  it('should decode simple CTC logits with collapse + blank removal', () => {
    // tokens: 0 blank, 1 "a", 2 "b"
    const tokens = ['', 'a', 'b'];
    // T=5, V=3
    // Sequence argmax: 0,1,1,0,2 => should become "ab"
    const logits = new Float32Array([
      10, 0, 0,
      0, 10, 0,
      0, 9, 0,
      10, 0, 0,
      0, 0, 10,
    ]);

    const decoded = vm.runInContext(
      `SenseVoiceProcessor.decodeCtcGreedy(new Float32Array([${Array.from(logits).join(',')}]), [1,5,3], ${JSON.stringify(tokens)}, 0)`,
      context
    );
    expect(decoded).toBe('ab');
  });
});
