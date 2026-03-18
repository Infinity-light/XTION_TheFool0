// =============================================================================
// XTION_TheFool0 — 管理员监控 API
// Requirements: 13.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import type { HealthStatus } from '../types';

export const adminMonitorRouter = Router();

interface ContestantMonitorRow {
  id: string;
  status: string;
  connected_at: number | null;
  disconnected_at: number | null;
}

function getAnomalyStatus(row: ContestantMonitorRow): HealthStatus | null {
  if (row.status === 'timeout') {
    return 'timeout';
  }

  const runtimeStatus = heartbeatMonitor.getHealthStatus(row.id);
  if (runtimeStatus === 'timeout' || runtimeStatus === 'delayed') {
    return runtimeStatus;
  }

  const hasBeenSeenOnline = row.connected_at !== null || row.disconnected_at !== null;
  if (row.status === 'offline' && hasBeenSeenOnline) {
    return 'offline';
  }

  return null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/monitor — 平台运行状态概览
// Requirements: 13.6
// ---------------------------------------------------------------------------

adminMonitorRouter.get('/monitor', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Online count
    const onlineCount = (db.prepare(
      "SELECT COUNT(*) as cnt FROM contestants WHERE status = 'online'",
    ).get() as { cnt: number }).cnt;

    // Zone population distribution
    const zonePopulation = db.prepare(`
      SELECT z.id as zone_id, z.name as zone_name, COUNT(c.id) as count
      FROM zones z
      LEFT JOIN contestants c ON c.current_zone_id = z.id AND c.status = 'online'
      GROUP BY z.id, z.name
    `).all() as Array<{ zone_id: string; zone_name: string; count: number }>;

    // Heartbeat anomalies — include delayed online contestants and timeout/offline contestants
    const contestants = db.prepare(`
      SELECT id, status, connected_at, disconnected_at
      FROM contestants
    `).all() as ContestantMonitorRow[];

    const heartbeatAnomalies = contestants
      .map((contestant) => {
        const anomalyStatus = getAnomalyStatus(contestant);
        if (!anomalyStatus) return null;

        return {
          contestantId: contestant.id,
          healthStatus: anomalyStatus,
        };
      })
      .filter((entry): entry is { contestantId: string; healthStatus: HealthStatus } => entry !== null);

    // Recent API call counts from events table (last 60 seconds)
    const since = Date.now() - 60_000;
    const recentApiCalls = (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE timestamp > ?',
    ).get(since) as { cnt: number }).cnt;

    res.json({
      onlineCount,
      zonePopulation: zonePopulation.map((zone) => ({
        zoneId: zone.zone_id,
        zoneName: zone.zone_name,
        count: zone.count,
      })),
      recentApiCallsPerMinute: recentApiCalls,
      heartbeatAnomalies,
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});
