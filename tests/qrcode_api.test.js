const request = require('supertest');
const app = require('../server');

describe('QRCode API', () => {
  it('should generate a QR code data URL', async () => {
    const text = 'http://localhost:3000/test-session';
    const res = await request(app).get(`/api/qrcode?text=${encodeURIComponent(text)}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('dataUrl');
    expect(res.body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('should return 400 if text is missing', async () => {
    const res = await request(app).get('/api/qrcode');
    expect(res.statusCode).toBe(400);
  });

  it('should return server info with localIp and port', async () => {
    const res = await request(app).get('/api/info');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('localIp');
    expect(res.body).toHaveProperty('port');
    expect(typeof res.body.localIp).toBe('string');
    expect(typeof res.body.port).toBe('number');
  });
});
