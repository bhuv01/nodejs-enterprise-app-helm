'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { setReady } = require('../src/routes/health');

const app = createApp();

describe('GET /api/info', () => {
  it('returns hostname and server time', async () => {
    const res = await request(app).get('/api/info');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('hostname');
    expect(res.body).toHaveProperty('serverTime');
    expect(res.body).toHaveProperty('epochMs');
    expect(new Date(res.body.serverTime).toString()).not.toBe('Invalid Date');
  });

  it('returns valid uptime as a number', async () => {
    const res = await request(app).get('/api/info');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('health probes', () => {
  it('liveness is always ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('readiness reflects ready flag', async () => {
    setReady(false);
    let res = await request(app).get('/readyz');
    expect(res.statusCode).toBe(503);

    setReady(true);
    res = await request(app).get('/readyz');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});

describe('metrics', () => {
  it('exposes prometheus metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('server_info_');
  });
});

describe('security & errors', () => {
  it('does not leak x-powered-by', async () => {
    const res = await request(app).get('/api/info');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets security headers (helmet)', async () => {
    const res = await request(app).get('/api/info');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers).toHaveProperty('content-security-policy');
  });

  it('returns 404 json for unknown route', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
