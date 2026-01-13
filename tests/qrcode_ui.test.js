const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

describe('QR Code UI', () => {
  let $;

  beforeAll(() => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    $ = cheerio.load(html);
  });

  it('should have a QR code button in the header', () => {
    const btn = $('#qr-btn');
    expect(btn.length).toBe(1);
  });

  it('should have a QR code modal', () => {
    const modal = $('#qr-modal');
    expect(modal.length).toBe(1);
  });
  
  it('should have an image element for QR code', () => {
    const img = $('#qr-image');
    expect(img.length).toBe(1);
  });
});
