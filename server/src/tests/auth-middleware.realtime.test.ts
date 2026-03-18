import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockDbGet, mockValidateKey, mockConnections } = vi.hoisted(() => ({
  mockDbGet: vi.fn(),
  mockValidateKey: vi.fn(),
  mockConnections: new Map<string, { readyState: number }>(),
}));

vi.mock('../db', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: mockDbGet,
    }),
  },
}));

vi.mock('../modules/auth-manager', () => ({
  authManager: {
    validateKey: mockValidateKey,
  },
}));

vi.mock('../ws', () => ({
  connections: mockConnections,
}));

import { authMiddleware } from '../middleware/auth';

function makeApp() {
  const app = express();
  app.get('/protected', authMiddleware, (req, res) => {
    res.json({
      keyId: req.keyId ?? null,
      contestantId: req.contestantId ?? null,
    });
  });

  app.use((
    err: Error & { statusCode?: number; code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(err.statusCode ?? 500).json({
      error: {
        code: err.code ?? 'SYS_INTERNAL_ERROR',
        message: err.message,
      },
    });
  });

  return app;
}

describe('authMiddleware realtime attachment gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnections.clear();
  });

  it('keeps keyId but clears contestantId when the contestant has no active websocket connection', async () => {
    mockValidateKey.mockResolvedValue({ valid: true, keyId: 'key-1' });
    mockDbGet.mockReturnValue({ id: 'contestant-1' });

    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer test-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keyId: 'key-1',
      contestantId: null,
    });
  });

  it('sets contestantId when the contestant still has an active websocket connection', async () => {
    mockValidateKey.mockResolvedValue({ valid: true, keyId: 'key-1' });
    mockDbGet.mockReturnValue({ id: 'contestant-1' });
    mockConnections.set('contestant-1', { readyState: 1 });

    const app = makeApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer test-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keyId: 'key-1',
      contestantId: 'contestant-1',
    });
  });
});
