const fs = require('fs');
const path = require('path');

describe('Virtual Keyboard Logic Implementation (Single Row Refactor)', () => {
  let mainJsContent;
  let indexHtmlContent;

  beforeAll(() => {
    mainJsContent = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
    indexHtmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  });

  describe('Key Bindings in main.js', () => {
    it('should have handleVirtualKey exposed to window', () => {
      expect(mainJsContent).toContain('window.handleVirtualKey = function(text)');
    });

    it('should bind direction keys', () => {
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x1b\[A['"]\)/); // Up
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x1b\[B['"]\)/); // Down
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x1b\[D['"]\)/); // Left
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x1b\[C['"]\)/); // Right
    });

    it('should bind control keys correctly', () => {
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x1b['"]\)/); // Esc
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\t['"]\)/);   // Tab
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x03['"]\)/); // Ctrl+C
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\r['"]\)/);   // Enter
      expect(mainJsContent).toMatch(/handleVirtualKey\(['"]\\x7f['"]\)/); // Backspace
    });

    it('should bind numeric keys 1-4', () => {
      expect(mainJsContent).toContain("window.handleVirtualKey('1')");
      expect(mainJsContent).toContain("window.handleVirtualKey('2')");
      expect(mainJsContent).toContain("window.handleVirtualKey('3')");
      expect(mainJsContent).toContain("window.handleVirtualKey('4')");
    });

    it('should NOT bind removed/unused keys', () => {
      expect(mainJsContent).not.toContain("window.handleVirtualKey('a')");
    });
  });

  describe('HTML Structure in index.html', () => {
    it('should have a single vk-row', () => {
      const rows = indexHtmlContent.match(/class="vk-row"/g) || [];
      expect(rows.length).toBe(1);
    });

    it('should have the fixed right section with two specific buttons', () => {
      expect(indexHtmlContent).toContain('class="vk-fixed-right"');
      expect(indexHtmlContent).toContain('id="ptt-btn"');
      expect(indexHtmlContent).toContain('id="vk-enter"');
      expect(indexHtmlContent).not.toContain('<div class="vk-fixed-right">\n        <button class="vk-btn-fixed" id="vk-drawer">⚡</button>');
    });
  });

  describe('CSS Styles in index.html', () => {
    it('should have 44px height for virtual keyboard', () => {
      expect(indexHtmlContent).toContain('height: 44px; /* Single row */');
    });

    it('should have appropriate terminal container bottom spacing', () => {
      expect(indexHtmlContent).toContain('bottom: 44px;');
    });
  });
});
