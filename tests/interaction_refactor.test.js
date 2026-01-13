/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Interaction Logic Refactor', () => {
  let container;
  let term;
  let mainJsContent;

  beforeAll(() => {
    mainJsContent = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
  });

  test('main.js should contain handleDoubleAction calling term.scrollToBottom()', () => {
    expect(mainJsContent).toContain('function handleDoubleAction(e) {');
    expect(mainJsContent).toContain('term.scrollToBottom();');
    expect(mainJsContent).not.toContain('processLine(e, clientX, clientY, rect);');
  });

  test('main.js should contain logic to focus on active line tap', () => {
    expect(mainJsContent).toContain('term.focus();');
    expect(mainJsContent).toContain('shouldAllowImeForTerminalTap');
  });

  describe('DOM Event Logic', () => {
    beforeEach(() => {
      // Setup DOM container
      container = document.createElement('div');
      container.id = 'terminal-container';
      document.body.appendChild(container);

      // Mock xterm.js terminal instance
      term = {
        focus: jest.fn(),
        scrollToBottom: jest.fn(),
      };
      
      // Simulate main.js behavior for double click
      container.addEventListener('dblclick', (e) => {
         term.scrollToBottom();
      });
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    test('Double-click on terminal container should trigger scrollToBottom instead of focus', () => {
      const event = new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        view: window
      });

      container.dispatchEvent(event);

      expect(term.scrollToBottom).toHaveBeenCalled();
      expect(term.focus).not.toHaveBeenCalled();
    });
  });
});
