// =============================================================================
// XTION_TheFool0 — Admin Heartbeat API 路由
// GET/PUT /api/admin/heartbeat/config
// GET /api/admin/contestants/:id/heartbeat-history
// Requirements: 9.3, 9.4, 9.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import type { ErrorResponse, HeartbeatConfig } from '../types';

export const adminHeartbeatRouter = Router();

let currentConfig: HeartbeatConfig = { interval: 10, timeout: 30 };

// ---------------------------------------------------------------------------
// GET /api/admin/heartbeat/config
// ---------------------------------------------------------------------------

adminHeartbeatRouter.get('/heartbeat/config', (_req: Request, res: Response): void => {
  res.status(200).json(currentConfig);
});

// ---------------------------------------------------------------------------
// PUT /api/admin/heartbeat/config
// ---------------------------------------------------------------------------

adminHeartbeatRouter.put('/heartbeat/config', (req: Request, res: Response): void => {
  const { interval, timeout } = req.body as Partial<HeartbeatConfig>;

  if (typeof interval !== 'number' || typeof timeout !== 'number') {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'interval 和 timeout 必须为数字' },
    };
    res.status(400).json(body);
    return;
  }

  try {
    heartbeatMonitor.updateConfig({ interval, timeout });
    currentConfig = { interval, timeout };
    res.status(200).json(currentConfig);
  } catch (err) {
    const body: ErrorResponse = {
      error: {
        code: 'SYS_INVALID_PARAMS',
        message: err instanceof Error ? err.message : '配置更新失败',
      },
    };
    res.status(400).json(body);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/contestants/:id/heartbeat-history
// ---------------------------------------------------------------------------

adminHeartbeatRouter.get('/contestants/:id/heartbeat-history', (req: Request, res: Response): void => {
  const id = req.params['id'] as string;
  const limitParam = req.query['limit'];
  const limit = limitParam !== undefined ? parseInt(String(limitParam), 10) : 100;

  if (isNaN(limit) || limit < 1) {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'limit 必须为正整数' },
    };
    res.status(400).json(body);
    return;
  }

  const history = heartbeatMonitor.getHistory(id, limit);

  res.status(200).json({
    contestantId: id,
    history,
  });
});


