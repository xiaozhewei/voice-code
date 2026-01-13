const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

describe('Push-to-Talk UI', () => {
  let $;

  beforeAll(() => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    $ = cheerio.load(html);
  });

  it('should have a microphone button in the input area', () => {
    // We expect the button to be added to the mobile header or near input.
    // Spec says: "In mobile header or next to input".
    // Product guidelines: "Mobile recording button located next to terminal input line."
    
    // Since xterm.js handles input, we might overlay a button or place it in the accessory bar.
    // Or in the header as a "temporary" place until we integrate deeply with xterm.
    // The guidelines said "Next to terminal input line", which implies an input field.
    // But xterm usually captures hidden input.
    
    // For now, let's place it in the Accessory Bar (Virtual Keys) or a floating action button (FAB) near bottom right?
    // User selected "Terminal input line side".
    
    // Let's add it to the accessory bar for now, or create a specific input bar wrapper if we were building a chat app.
    // Given the current layout, the accessory bar is the closest thing to "input controls".
    
    // Let's check for a button with id 'ptt-btn'.
    const btn = $('#ptt-btn');
    expect(btn.length).toBe(1);
  });

  it('should have a recording overlay', () => {
    const overlay = $('#recording-overlay');
    expect(overlay.length).toBe(1);
  });
});
