// =============================================================================
// XTION_TheFool0 — Heartbeat API 路由
// POST /api/heartbeat
// Requirements: 9.3, 9.4, 9.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import type { ErrorResponse, HeartbeatPayload } from '../types';

export const heartbeatRouter = Router();

function normalizeHeartbeatPayload(payload: unknown): HeartbeatPayload | null {
  if (!payload || typeof payload !== 'object') return null;

  const body = payload as Record<string, unknown>;
  const cpuLoad = body['cpuLoad'] ?? body['cpu_load'];
  const memoryUsage = body['memoryUsage'] ?? body['memory_usage'];
  const responseLatency = body['responseLatency'] ?? body['response_latency'] ?? body['response_latency_ms'];

  if (
    typeof cpuLoad !== 'number' ||
    typeof memoryUsage !== 'number' ||
    typeof responseLatency !== 'number'
  ) {
    return null;
  }

  return { cpuLoad, memoryUsage, responseLatency };
}

// ---------------------------------------------------------------------------
// POST /api/heartbeat
// ---------------------------------------------------------------------------

heartbeatRouter.post('/', (req: Request, res: Response): void => {
  const contestantId = req.contestantId;
  if (!contestantId) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_CONTESTANT_NOT_REGISTERED', message: '当前 Key 尚未通过 WebSocket 完成接入' },
    };
    res.status(409).json(body);
    return;
  }

  const { payload } = req.body as { payload?: unknown };

  const normalizedPayload = normalizeHeartbeatPayload(payload);
  if (!normalizedPayload) {
    const body: ErrorResponse = {
      error: {
        code: 'SYS_INVALID_PARAMS',
        message: 'payload 必须包含 cpuLoad/memoryUsage/responseLatency 或 cpu_load/memory_usage/response_latency_ms',
      },
    };
    res.status(400).json(body);
    return;
  }

  heartbeatMonitor.onHeartbeat(contestantId, normalizedPayload);

  const serverTimestamp = Date.now();

  res.status(200).json({
    ok: true,
    timestamp: serverTimestamp,
    serverTimestamp,
    pendingEvents: 0,
  });
});
