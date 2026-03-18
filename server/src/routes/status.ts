// =============================================================================
// XTION_TheFool0 — Status API 端点
// Requirements: 8.3, 8.6, 8.7, 8.8, 8.9, 13.1, 13.2, 13.3, 13.4
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { worldManager } from '../modules/world-manager';
import type { HeartbeatRecord, ZoneRule } from '../types';

export const statusRouter = Router();

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface ContestantRow {
  id: string;
  key_id: string;
  name: string;
  status: string;
  position_x: number;
  position_y: number;
  current_zone_id: string | null;
  energy: number;
  installed_skills: string;
  attributes: string;
  connected_at: number | null;
  disconnected_at: number | null;
}

interface ZoneRow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  zone_type_id: string;
  fill_color: string;
  border_color: string;
  opacity: number;
  icon: string | null;
  access_restriction: string | null;
}

interface ZoneInfoRow {
  id: string;
  name: string;
  zone_type_id: string;
  zone_type_name: string | null;
}

interface ZoneRuleRow {
  allowed_apis: string;
  forbidden_apis: string;
  rate_limits: string;
  attribute_effects: string;
  custom_params: string;
}

function rowToZone(r: ZoneRow) {
  return {
    id: r.id,
    name: r.name,
    bounds: { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 },
    zoneTypeId: r.zone_type_id,
    style: {
      fillColor: r.fill_color,
      borderColor: r.border_color,
      opacity: r.opacity,
      ...(r.icon ? { icon: r.icon } : {}),
    },
    ...(r.access_restriction ? { accessRestriction: JSON.parse(r.access_restriction) as string[] } : {}),
  };
}

function getZoneInfo(zoneId: string | null) {
  if (!zoneId) return null;

  const row = db.prepare(`
    SELECT z.id, z.name, z.zone_type_id, zt.name as zone_type_name
    FROM zones z
    LEFT JOIN zone_types zt ON z.zone_type_id = zt.id
    WHERE z.id = ?
  `).get(zoneId) as ZoneInfoRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    zoneTypeId: row.zone_type_id,
    zoneTypeName: row.zone_type_name ?? row.zone_type_id,
  };
}

function getZoneRuleSummary(zoneTypeId: string) {
  const row = db.prepare(`
    SELECT allowed_apis, forbidden_apis, rate_limits, attribute_effects, custom_params
    FROM zone_rules
    WHERE zone_type_id = ?
  `).get(zoneTypeId) as ZoneRuleRow | undefined;

  if (!row) {
    return {
      allowedAPIs: ['*'],
      forbiddenAPIs: [],
    };
  }

  return {
    allowedAPIs: JSON.parse(row.allowed_apis) as string[],
    forbiddenAPIs: JSON.parse(row.forbidden_apis) as string[],
  };
}

function getContestantIdOrThrow(req: Request): string {
  if (!req.contestantId) {
    throw httpError(409, 'AUTH_CONTESTANT_NOT_REGISTERED', '当前 Key 尚未通过 WebSocket 完成接入');
  }
  return req.contestantId;
}

function getZoneTypes() {
  interface ZoneTypeRow {
    id: string;
    name: string;
    description: string;
    is_builtin: number;
  }

  interface FullZoneRuleRow {
    allowed_apis: string;
    forbidden_apis: string;
    rate_limits: string;
    attribute_effects: string;
    custom_params: string;
  }

  const rows = db.prepare('SELECT * FROM zone_types').all() as ZoneTypeRow[];
  return rows.map((row) => {
    const ruleRow = db.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get(row.id) as FullZoneRuleRow | undefined;
    const rule: ZoneRule = ruleRow
      ? {
          allowedAPIs: JSON.parse(ruleRow.allowed_apis) as string[],
          forbiddenAPIs: JSON.parse(ruleRow.forbidden_apis) as string[],
          rateLimits: JSON.parse(ruleRow.rate_limits) as Record<string, number>,
          attributeEffects: JSON.parse(ruleRow.attribute_effects) as [],
          customParams: JSON.parse(ruleRow.custom_params) as Record<string, unknown>,
        }
      : { allowedAPIs: ['*'], forbiddenAPIs: [], rateLimits: {}, attributeEffects: [], customParams: {} };

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isBuiltin: row.is_builtin === 1,
      rule,
    };
  });
}

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
// GET /api/status/me — 自身完整状态
// Requirements: 8.6, 13.1
// ---------------------------------------------------------------------------

statusRouter.get('/status/me', (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = getContestantIdOrThrow(req);

    const row = db.prepare('SELECT * FROM contestants WHERE id = ?').get(contestantId) as ContestantRow | undefined;
    if (!row) return next(httpError(404, 'CONTESTANT_NOT_FOUND', '选手不存在'));

    const zoneRule = worldManager.getApplicableRules(contestantId);
    const zone = getZoneInfo(row.current_zone_id);

    res.json({
      id: row.id,
      name: row.name,
      status: row.status,
      position: { x: row.position_x, y: row.position_y },
      currentZoneId: row.current_zone_id,
      currentZoneName: zone?.name ?? null,
      currentZoneTypeId: zone?.zoneTypeId ?? null,
      currentZoneTypeName: zone?.zoneTypeName ?? null,
      currentZone: zone,
      energy: row.energy,
      installedSkills: JSON.parse(row.installed_skills) as string[],
      zoneRuleSummary: {
        allowedAPIs: zoneRule.allowedAPIs,
        forbiddenAPIs: zoneRule.forbiddenAPIs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/status/:id — 其他 Contestant 公开状态
// Requirements: 13.2
// ---------------------------------------------------------------------------

statusRouter.get('/status/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = db.prepare('SELECT * FROM contestants WHERE id = ?').get(req.params['id'] as string) as ContestantRow | undefined;
    if (!row) return next(httpError(404, 'CONTESTANT_NOT_FOUND', '选手不存在'));
    const zone = getZoneInfo(row.current_zone_id);

    res.json({
      id: row.id,
      name: row.name,
      status: row.status,
      position: { x: row.position_x, y: row.position_y },
      currentZoneId: row.current_zone_id,
      currentZoneName: zone?.name ?? null,
      currentZoneTypeId: zone?.zoneTypeId ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/contestants — 在线 Contestant 列表（可按 Zone 过滤）
// Requirements: 8.7
// ---------------------------------------------------------------------------

statusRouter.get('/contestants', (req: Request, res: Response, next: NextFunction) => {
  try {
    let zoneId = req.query['zone_id'] as string | undefined;

    if (!zoneId && req.contestantId) {
      const ownZone = db.prepare(
        'SELECT current_zone_id FROM contestants WHERE id = ?',
      ).get(req.contestantId) as { current_zone_id: string | null } | undefined;
      zoneId = ownZone?.current_zone_id ?? undefined;
    }

    let rows: ContestantRow[];
    if (zoneId) {
      rows = db.prepare(
        "SELECT * FROM contestants WHERE status = 'online' AND current_zone_id = ?",
      ).all(zoneId) as ContestantRow[];
    } else {
      rows = db.prepare(
        "SELECT * FROM contestants WHERE status = 'online'",
      ).all() as ContestantRow[];
    }

    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      position: { x: r.position_x, y: r.position_y },
      currentZoneId: r.current_zone_id,
    })));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/contestants/:id/heartbeat-history — 查询心跳历史
// ---------------------------------------------------------------------------

statusRouter.get('/contestants/:id/heartbeat-history', (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitParam = req.query['limit'];
    const limit = limitParam !== undefined ? parseInt(String(limitParam), 10) : 100;

    if (isNaN(limit) || limit < 1) {
      return next(httpError(400, 'SYS_INVALID_PARAMS', 'limit 必须为正整数'));
    }

    res.json({
      contestantId: req.params['id'] as string,
      history: getHeartbeatHistory(req.params['id'] as string, limit),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/zones — 所有 Zone 信息
// Requirements: 8.8
// ---------------------------------------------------------------------------

statusRouter.get('/zones', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = db.prepare('SELECT * FROM zones').all() as ZoneRow[];
    res.json(rows.map((row) => {
      const onlineContestantCount = (db.prepare(
        "SELECT COUNT(*) as cnt FROM contestants WHERE current_zone_id = ? AND status = 'online'",
      ).get(row.id) as { cnt: number }).cnt;
      const zone = getZoneInfo(row.id);

      return {
        ...rowToZone(row),
        zoneTypeName: zone?.zoneTypeName ?? row.zone_type_id,
        onlineContestantCount,
      };
    }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/zone-types — 所有 Zone_Type 信息
// ---------------------------------------------------------------------------

statusRouter.get('/zone-types', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getZoneTypes());
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/zones/:id — Zone 详情（含在线 Contestant 列表）
// Requirements: 13.3
// ---------------------------------------------------------------------------

statusRouter.get('/zones/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const zoneId = req.params['id'] as string;
    const row = db.prepare('SELECT * FROM zones WHERE id = ?').get(zoneId) as ZoneRow | undefined;
    if (!row) return next(httpError(404, 'ZONE_NOT_FOUND', 'Zone 不存在'));
    const zone = getZoneInfo(zoneId);

    const contestants = db.prepare(
      "SELECT id, name, status, position_x, position_y FROM contestants WHERE current_zone_id = ? AND status = 'online'",
    ).all(zoneId) as Array<{ id: string; name: string; status: string; position_x: number; position_y: number }>;

    res.json({
      ...rowToZone(row),
      zoneTypeName: zone?.zoneTypeName ?? row.zone_type_id,
      zoneRuleSummary: getZoneRuleSummary(row.zone_type_id),
      onlineContestantCount: contestants.length,
      onlineContestants: contestants.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        position: { x: c.position_x, y: c.position_y },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/world — World 概览
// Requirements: 8.9, 13.4
// ---------------------------------------------------------------------------

statusRouter.get('/world', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mapDims = db.prepare('SELECT MAX(x2) as width, MAX(y2) as height FROM zones').get() as
      | { width: number | null; height: number | null };

    const zones = (db.prepare('SELECT * FROM zones').all() as ZoneRow[]).map(rowToZone);

    const onlineTotal = (db.prepare(
      "SELECT COUNT(*) as cnt FROM contestants WHERE status = 'online'",
    ).get() as { cnt: number }).cnt;

    const zonePopulation = zones.map(z => {
      const cnt = (db.prepare(
        "SELECT COUNT(*) as cnt FROM contestants WHERE current_zone_id = ? AND status = 'online'",
      ).get(z.id) as { cnt: number }).cnt;
      return { zoneId: z.id, zoneName: z.name, count: cnt };
    });

    res.json({
      map: { width: mapDims.width ?? 1000, height: mapDims.height ?? 800 },
      zones,
      onlineTotal,
      zonePopulation,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/messages — 消息历史（分页）
// Requirements: 8.3
// ---------------------------------------------------------------------------

statusRouter.get('/messages', (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = getContestantIdOrThrow(req);
    const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : 1;
    const pageSizeParam = req.query['page_size'] ?? req.query['pageSize'];
    const pageSize = pageSizeParam ? parseInt(pageSizeParam as string, 10) : 20;
    const offset = (page - 1) * pageSize;

    const talkRows = db.prepare(
      'SELECT id, sender_id, receiver_ids, content, zone_id, timestamp FROM talk_messages ORDER BY timestamp DESC',
    ).all() as Array<{
      id: string; sender_id: string; receiver_ids: string; content: string;
      zone_id: string; timestamp: number;
    }>;

    const talks = talkRows
      .filter((row) => {
        const receiverIds = JSON.parse(row.receiver_ids) as string[];
        return row.sender_id === contestantId || receiverIds.includes(contestantId);
      })
      .slice(offset, offset + pageSize);

    const broadcasts = db.prepare(
      'SELECT id, sender_id, content, timestamp FROM broadcast_messages ORDER BY timestamp DESC LIMIT ? OFFSET ?',
    ).all(pageSize, offset) as Array<{
      id: string; sender_id: string; content: string; timestamp: number;
    }>;

    res.json({
      talks: talks.map(t => ({
        id: t.id, senderId: t.sender_id,
        receiverIds: JSON.parse(t.receiver_ids) as string[],
        content: t.content, zoneId: t.zone_id, timestamp: t.timestamp,
      })),
      broadcasts: broadcasts.map(b => ({
        id: b.id, senderId: b.sender_id, content: b.content, timestamp: b.timestamp,
      })),
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});
