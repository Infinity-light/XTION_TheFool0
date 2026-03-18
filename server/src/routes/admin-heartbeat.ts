// =============================================================================
// XTION_TheFool0 — Admin Heartbeat API 路由
// GET/PUT /api/admin/heartbeat/config
// GET /api/admin/contestants/:id/heartbeat-history
// Requirements: 9.3, 9.4, 9.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import type { ErrorResponse, HeartbeatConfig, HeartbeatRecord } from '../types';

export const adminHeartbeatRouter = Router();

let currentConfig: HeartbeatConfig = { interval: 10, timeout: 30 };

function getHeartbeatHistory(contestantId: string, limit: number): HeartbeatRecord[] {
  const cap = Math.min(limit, 100);
  const rows = db.prepare(`
    SELECT contestant_id, timestamp, cpu_load, memory_usage, response_latency
    FROM heartbeat_records
    WHERE contestant_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(contestantId, cap) as Array<{
    contestant_id: string;
    timestamp: number;
    cpu_load: number;
    memory_usage: number;
    response_latency: number;
  }>;

  return rows.map((row) => ({
    contestantId: row.contestant_id,
    timestamp: row.timestamp,
    payload: {
      cpuLoad: row.cpu_load,
      memoryUsage: row.memory_usage,
      responseLatency: row.response_latency,
    },
  }));
}

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

  const history = getHeartbeatHistory(id, limit);

  res.status(200).json({
    contestantId: id,
    history,
  });
});

