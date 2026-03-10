import { describe, expect, mock, test } from 'bun:test';
import { InProcessEventBus } from '@clawgear/kernel';
import { createApp } from './app.js';

// Mock database that returns a result for SELECT 1
const mockDb = {
  execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
} as any;

describe('API Server', () => {
  const eventBus = new InProcessEventBus();
  const app = createApp({ db: mockDb, eventBus });

  test('GET /api returns API info', async () => {
    const res = await app.request('/api');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('ClawGear API');
    expect(body.version).toBe('0.1.0');
  });

  test('GET /api/health returns ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.uptime).toBe('number');
  });

  test('GET /api/health/detail returns database status', async () => {
    const res = await app.request('/api/health/detail');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.database.connected).toBe(true);
    expect(typeof body.database.latencyMs).toBe('number');
  });

  test('GET /api/health/detail returns degraded when db is down', async () => {
    const failDb = {
      execute: mock(() => Promise.reject(new Error('connection refused'))),
    } as any;
    const failApp = createApp({ db: failDb, eventBus });

    const res = await failApp.request('/api/health/detail');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.database.connected).toBe(false);
  });

  test('404 for unknown routes', async () => {
    const res = await app.request('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  test('CORS headers are present', async () => {
    const res = await app.request('/api', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});
