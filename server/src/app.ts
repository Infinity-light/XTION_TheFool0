// =============================================================================
// XTION_TheFool0 — Express 应用配置
// Requirements: 8.1, 8.10
// =============================================================================

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { ErrorResponse } from './types/index';
import { adminKeysRouter } from './routes/admin-keys';
import { adminZonesRouter } from './routes/admin-zones';
import { adminMoveRouter } from './routes/admin-move';
import { talkRouter } from './routes/talk';
import { broadcastRouter } from './routes/broadcast';
import { moveRouter } from './routes/move';
import { heartbeatRouter } from './routes/heartbeat';
import { adminHeartbeatRouter } from './routes/admin-heartbeat';
import { adminSkillsRouter } from './routes/admin-skills';
import { skillsRouter } from './routes/skills';
import { docsRouter, adminDocsRouter } from './routes/docs';
import { eventsRouter } from './routes/events';
import { interactionRouter } from './routes/interaction';
import { statusRouter } from './routes/status';
import { adminMonitorRouter } from './routes/admin-monitor';
import { authMiddleware } from './middleware/auth';
import { adminAuthMiddleware } from './middleware/admin-auth';
import { rateLimitMiddleware } from './modules/rate-limiter';

export const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/api/admin/keys', adminAuthMiddleware, adminKeysRouter);
app.use('/api/admin', adminAuthMiddleware, adminZonesRouter);
app.use('/api/admin', adminAuthMiddleware, adminMoveRouter);
app.use('/api/talk', authMiddleware, rateLimitMiddleware, talkRouter);
app.use('/api/broadcast', authMiddleware, rateLimitMiddleware, broadcastRouter);
app.use('/api/move', authMiddleware, rateLimitMiddleware, moveRouter);
app.use('/api/heartbeat', authMiddleware, rateLimitMiddleware, heartbeatRouter);
app.use('/api/admin', adminAuthMiddleware, adminHeartbeatRouter);
app.use('/api/admin/skills', adminAuthMiddleware, adminSkillsRouter);
app.use('/api/skills', authMiddleware, rateLimitMiddleware, skillsRouter);
app.use('/api/docs', authMiddleware, rateLimitMiddleware, docsRouter);
app.use('/api/admin/docs', adminAuthMiddleware, adminDocsRouter);
app.use('/api', authMiddleware, rateLimitMiddleware, eventsRouter);
app.use('/api', interactionRouter);
app.use('/api', authMiddleware, rateLimitMiddleware, statusRouter);
app.use('/api/admin', adminAuthMiddleware, adminMonitorRouter);

// ---------------------------------------------------------------------------
// Unified error handler — { "error": { "code": "...", "message": "..." } }
// Requirements: 8.10
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error & { statusCode?: number; code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'SYS_INTERNAL_ERROR';
  const message = err.message || '内部服务器错误';

  const body: ErrorResponse = {
    error: { code, message },
  };

  res.status(statusCode).json(body);
}

app.use(errorHandler);
