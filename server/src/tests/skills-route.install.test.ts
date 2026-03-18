import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockInstallSkill, mockListAvailableSkills } = vi.hoisted(() => ({
  mockInstallSkill: vi.fn(),
  mockListAvailableSkills: vi.fn(),
}));

vi.mock('../modules/doc-distributor', () => ({
  docDistributor: {
    installSkill: mockInstallSkill,
    listAvailableSkills: mockListAvailableSkills,
  },
}));

import { skillsRouter } from '../routes/skills';

function makeApp(middleware?: express.RequestHandler) {
  const app = express();
  if (middleware) {
    app.use(middleware);
  }
  app.use('/api/skills', skillsRouter);
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

describe('skills install route gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 409 when install is requested without an attached contestant session', async () => {
    const app = makeApp((req, _res, next) => {
      req.keyId = 'key-1';
      next();
    });

    const res = await request(app).get('/api/skills/skill-talk-default/install');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUTH_CONTESTANT_NOT_REGISTERED');
    expect(mockInstallSkill).not.toHaveBeenCalled();
  });

  it('installs the skill for the active contestant session', async () => {
    mockInstallSkill.mockResolvedValue('# skill markdown');

    const app = makeApp((req, _res, next) => {
      req.keyId = 'key-1';
      req.contestantId = 'contestant-1';
      next();
    });

    const res = await request(app).get('/api/skills/skill-talk-default/install');

    expect(res.status).toBe(200);
    expect(res.text).toBe('# skill markdown');
    expect(mockInstallSkill).toHaveBeenCalledWith('contestant-1', 'skill-talk-default');
  });
});
