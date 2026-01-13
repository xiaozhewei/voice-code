const TerminalLogic = require('../public/terminal-logic');

describe('TerminalLogic', () => {
  describe('formatSelectedLine', () => {
    test('removes trailing newline characters', () => {
      expect(TerminalLogic.formatSelectedLine('hello\n')).toBe('hello');
      expect(TerminalLogic.formatSelectedLine('world\r')).toBe('world');
      expect(TerminalLogic.formatSelectedLine('cmd\r\n')).toBe('cmd');
    });

    test('preserves leading and trailing whitespace', () => {
      expect(TerminalLogic.formatSelectedLine('  spaced  ')).toBe('  spaced  ');
      expect(TerminalLogic.formatSelectedLine('\tindented')).toBe('\tindented');
    });

    test('handles empty strings and nulls', () => {
      expect(TerminalLogic.formatSelectedLine('')).toBe('');
      expect(TerminalLogic.formatSelectedLine(null)).toBe('');
      expect(TerminalLogic.formatSelectedLine(undefined)).toBe('');
    });

    test('combined whitespace and newline', () => {
      expect(TerminalLogic.formatSelectedLine('  line with space\n')).toBe('  line with space');
      expect(TerminalLogic.formatSelectedLine('  line with space \r\n')).toBe('  line with space ');
    });
  });
});
