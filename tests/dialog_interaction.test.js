const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

describe('Dialog Structure Integrity', () => {
  let $;
  let mainJsContent;

  beforeAll(() => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    $ = cheerio.load(html);
    mainJsContent = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');
  });

  test('Settings Modal elements exist and match main.js references', () => {
    const ids = ['settings-modal', 'settings-btn', 'close-modal-btn', 'reset-settings-btn', 'apply-settings-btn'];
    
    ids.forEach(id => {
      // Check HTML
      expect($(`#${id}`).length).toBe(1);
      
      // Check JS reference (simple string check)
      expect(mainJsContent).toContain(`getElementById('${id}')`);
    });
  });

  test('QR Modal elements exist and match main.js references', () => {
    const ids = ['qr-modal', 'qr-btn', 'close-qr-btn', 'qr-image'];
    
    ids.forEach(id => {
      // Check HTML
      expect($(`#${id}`).length).toBe(1);
      
      // Check JS reference
      expect(mainJsContent).toContain(`getElementById('${id}')`);
    });
  });
});