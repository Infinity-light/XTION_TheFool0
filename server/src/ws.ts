// =============================================================================
// XTION_TheFool0 — WebSocket 服务器
// Requirements: 1.3, 1.4, 1.5, 1.7, 1.8, 8.4
// =============================================================================

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { authManager } from './modules/auth-manager';
import { docDistributor } from './modules/doc-distributor';
import { heartbeatMonitor } from './modules/heartbeat-monitor';
import type { ClientMessage, ServerEvent, Contestant, Position, Zone } from './types/index';

// ---------------------------------------------------------------------------
// Connection registry — contestantId → WebSocket
// ---------------------------------------------------------------------------

export const connections = new Map<string, WebSocket>();

// Disconnect timers — contestantId → NodeJS.Timeout
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface ZoneRow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  zone_type_id: string;
}

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

interface ReconnectState {
  position: Position;
  zoneId: string;
}

function getDefaultZone(): ZoneRow | null {
  // Prefer zt-social zone, fallback to first zone
  const zone = db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id FROM zones
    WHERE zone_type_id = 'zt-social'
    LIMIT 1
  `).get() as ZoneRow | undefined;

  if (zone) return zone;

  return db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id FROM zones LIMIT 1
  `).get() as ZoneRow | null;
}

function getZoneCenterPosition(zone: ZoneRow): Position {
  return {
    x: (zone.x1 + zone.x2) / 2,
    y: (zone.y1 + zone.y2) / 2,
  };
}

function getZoneById(zoneId: string): ZoneRow | null {
  return db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id FROM zones WHERE id = ?
  `).get(zoneId) as ZoneRow | null;
}

function resolveReconnectState(
  existing: ContestantRow,
  fallbackPosition: Position,
  fallbackZoneId: string,
): ReconnectState {
  if (!existing.current_zone_id) {
    return { position: fallbackPosition, zoneId: fallbackZoneId };
  }

  const existingZone = getZoneById(existing.current_zone_id);
  if (!existingZone) {
    return { position: fallbackPosition, zoneId: fallbackZoneId };
  }

  return {
    position: { x: existing.position_x, y: existing.position_y },
    zoneId: existing.current_zone_id,
  };
}

function upsertContestant(keyId: string, name: string, position: Position, zoneId: string): Contestant {
  const now = Date.now();

  // Check if contestant already exists for this key
  const existing = db.prepare(`
    SELECT * FROM contestants WHERE key_id = ?
  `).get(keyId) as ContestantRow | undefined;

  if (existing) {
    const reconnectState = resolveReconnectState(existing, position, zoneId);

    // Update existing contestant to online
    db.prepare(`
      UPDATE contestants
      SET name = ?, status = 'online', position_x = ?, position_y = ?, current_zone_id = ?, connected_at = ?, disconnected_at = NULL
      WHERE key_id = ?
    `).run(name, reconnectState.position.x, reconnectState.position.y, reconnectState.zoneId, now, keyId);

    return {
      id: existing.id,
      keyId,
      name,
      status: 'online',
      position: reconnectState.position,
      currentZoneId: reconnectState.zoneId,
      energy: existing.energy,
      installedSkills: JSON.parse(existing.installed_skills) as string[],
      attributes: JSON.parse(existing.attributes) as Record<string, unknown>,
      connectedAt: now,
    };
  }

  // Create new contestant
  const id = uuidv4();
  db.prepare(`
    INSERT INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes, connected_at)
    VALUES (?, ?, ?, 'online', ?, ?, ?, 100, '[]', '{}', ?)
  `).run(id, keyId, name, position.x, position.y, zoneId, now);

  return {
    id,
    keyId,
    name,
    status: 'online',
    position,
    currentZoneId: zoneId,
    energy: 100,
    installedSkills: [],
    attributes: {},
    connectedAt: now,
  };
}

function markContestantOffline(contestantId: string): void {
  const now = Date.now();
  db.prepare(`
    UPDATE contestants SET status = 'offline', disconnected_at = ? WHERE id = ?
  `).run(now, contestantId);
}

function getAllOnlineContestants(): Contestant[] {
  const rows = db.prepare(`
    SELECT * FROM contestants WHERE status = 'online'
  `).all() as ContestantRow[];

  return rows.map(rowToContestant);
}

function rowToContestant(row: ContestantRow): Contestant {
  return {
    id: row.id,
    keyId: row.key_id,
    name: row.name,
    status: row.status as Contestant['status'],
    position: { x: row.position_x, y: row.position_y },
    currentZoneId: row.current_zone_id,
    energy: row.energy,
    installedSkills: JSON.parse(row.installed_skills) as string[],
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
    ...(row.connected_at != null ? { connectedAt: row.connected_at } : {}),
    ...(row.disconnected_at != null ? { disconnectedAt: row.disconnected_at } : {}),
  };
}

function getAllZones(): Zone[] {
  const rows = db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id, fill_color, border_color, opacity, icon, access_restriction
    FROM zones
  `).all() as Array<{
    id: string; name: string; x1: number; y1: number; x2: number; y2: number;
    zone_type_id: string; fill_color: string; border_color: string; opacity: number;
    icon: string | null; access_restriction: string | null;
  }>;

  return rows.map((r) => ({
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
  }));
}

function getMapDimensions(): { width: number; height: number } {
  // Derive map dimensions from the bounding box of all zones
  const result = db.prepare(`
    SELECT MAX(x2) as width, MAX(y2) as height FROM zones
  `).get() as { width: number | null; height: number | null };

  return {
    width: result.width ?? 1000,
    height: result.height ?? 800,
  };
}

// ---------------------------------------------------------------------------
// Auth handler
// ---------------------------------------------------------------------------

async function handleAuth(
  ws: WebSocket,
  payload: { key: string; name?: string },
  registerContestant: (id: string) => void,
): Promise<void> {
  const { key, name } = payload;

  // Validate key
  const result = await authManager.validateKey(key);
  if (!result.valid || !result.keyId) {
    sendError(ws, 'AUTH_INVALID_KEY', 'Key 无效或已被吊销');
    ws.close(1008, 'AUTH_INVALID_KEY');
    return;
  }

  const keyId = result.keyId;

  // Get default zone and compute initial position
  const defaultZone = getDefaultZone();
  if (!defaultZone) {
    sendError(ws, 'SYS_NO_ZONE', '系统未配置任何 Zone，请联系管理员');
    ws.close(1011, 'SYS_NO_ZONE');
    return;
  }

  const initialPosition = getZoneCenterPosition(defaultZone);

  // Determine contestant name: use provided name or fall back to key's contestantName
  const keyRow = db.prepare('SELECT contestant_name FROM keys WHERE id = ?').get(keyId) as { contestant_name: string } | undefined;
  const contestantName = name ?? keyRow?.contestant_name ?? 'Unknown';

  // Register/update contestant in DB
  const contestant = upsertContestant(keyId, contestantName, initialPosition, defaultZone.id);

  // Cancel any pending offline timer for this contestant (reconnect scenario)
  const existingTimer = disconnectTimers.get(contestant.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    disconnectTimers.delete(contestant.id);
  }

  // Register connection
  registerContestant(contestant.id);
  heartbeatMonitor.register(contestant.id);

  // Build world.state payload
  const zones = getAllZones();
  const mapDims = getMapDimensions();
  const onlineContestants = getAllOnlineContestants();

  const worldStatePayload = {
    map: {
      width: mapDims.width,
      height: mapDims.height,
      zones,
    },
    contestants: onlineContestants.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      zone: c.currentZoneId,
      status: c.status,
    })),
    self: {
      id: contestant.id,
      name: contestant.name,
      position: contestant.position,
      zone: contestant.currentZoneId,
      energy: contestant.energy,
      status: contestant.status,
    },
  };

  sendEvent(ws, {
    type: 'world.state',
    payload: worldStatePayload,
    timestamp: Date.now(),
  });

  // Notify other online contestants that this contestant joined
  broadcast(
    {
      type: 'contestant.join',
      payload: {
        id: contestant.id,
        name: contestant.name,
        position: contestant.position,
        zone: contestant.currentZoneId,
        status: contestant.status,
      },
      timestamp: Date.now(),
    },
    contestant.id,
  );

  // Push mandatory documents to newly connected contestant (Requirements: 9.2, 12.3)
  docDistributor.pushMandatoryDocuments(contestant.id).catch((err: unknown) => {
    console.error('[WS] pushMandatoryDocuments error:', err);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupWebSocket(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let contestantId: string | null = null;

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        sendError(ws, 'SYS_INVALID_JSON', '消息格式错误，需要 JSON');
        return;
      }

      handleMessage(ws, msg, (id) => {
        contestantId = id;
        const previousConnection = connections.get(id);
        connections.set(id, ws);
        if (previousConnection && previousConnection !== ws) {
          previousConnection.close(1000, 'replaced_by_new_connection');
        }
      });
    });

    ws.on('close', () => {
      if (contestantId) {
        if (connections.get(contestantId) !== ws) {
          return;
        }

        connections.delete(contestantId);

        const idToMark = contestantId;

        // Schedule offline marking after 5 seconds, preserving position
        const timer = setTimeout(() => {
          const row = db.prepare(
            'SELECT status FROM contestants WHERE id = ?',
          ).get(idToMark) as { status: string } | undefined;

          if (row?.status === 'offline') {
            heartbeatMonitor.unregister(idToMark);
            disconnectTimers.delete(idToMark);
            return;
          }

          markContestantOffline(idToMark);
          heartbeatMonitor.unregister(idToMark);
          disconnectTimers.delete(idToMark);

          // Notify remaining online contestants
          broadcast(
            {
              type: 'contestant.leave',
              payload: { id: idToMark, status: 'offline' },
              timestamp: Date.now(),
            },
          );
        }, 5000);

        disconnectTimers.set(idToMark, timer);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] socket error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[WS] server error:', err.message);
  });

  return wss;
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

function handleMessage(
  ws: WebSocket,
  msg: ClientMessage,
  registerContestant: (id: string) => void,
): void {
  switch (msg.type) {
    case 'ping':
      sendEvent(ws, { type: 'pong', payload: {}, timestamp: Date.now() });
      break;

    case 'auth': {
      const payload = msg.payload as { key: string; name?: string };
      if (!payload?.key) {
        sendError(ws, 'AUTH_MISSING_KEY', '认证消息缺少 key 字段');
        return;
      }
      handleAuth(ws, payload, registerContestant).catch((err: unknown) => {
        console.error('[WS] auth error:', err);
        sendError(ws, 'SYS_INTERNAL', '认证过程发生内部错误');
        ws.close(1011, 'SYS_INTERNAL');
      });
      break;
    }

    default:
      // Unknown message types are silently ignored until handlers are registered
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sendEvent(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

export function broadcast(event: ServerEvent, exclude?: string): void {
  for (const [id, ws] of connections) {
    if (exclude && id === exclude) continue;
    sendEvent(ws, event);
  }
}

docDistributor.attachRealtime(connections, sendEvent);
heartbeatMonitor.attachRealtime(connections, sendEvent, broadcast);

function sendError(ws: WebSocket, code: string, message: string): void {
  sendEvent(ws, {
    type: 'error',
    payload: { error: { code, message } },
    timestamp: Date.now(),
  });
}
