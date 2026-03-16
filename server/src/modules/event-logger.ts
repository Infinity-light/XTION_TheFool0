// =============================================================================
// XTION_TheFool0 — EventLogger 模块
// Requirements: 13.5
// =============================================================================

import type { Database as DatabaseType } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { db as globalDb } from '../db';
import type { IEventLogger, PlatformEvent, EventFilter, EventType } from '../types';

// ---------------------------------------------------------------------------
// EventLoggerClass — injectable for testing
// ---------------------------------------------------------------------------

export class EventLoggerClass implements IEventLogger {
  private db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  async log(event: Omit<PlatformEvent, 'id' | 'timestamp'>): Promise<void> {
    const id = uuidv4();
    const timestamp = Date.now();
    this.db.prepare(`
      INSERT INTO events (id, type, contestant_id, data, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      event.type,
      event.contestantId ?? null,
      JSON.stringify(event.data),
      timestamp,
    );
  }

  async query(filter: EventFilter): Promise<{ events: PlatformEvent[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.contestantId) {
      conditions.push('contestant_id = ?');
      params.push(filter.contestantId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = (this.db.prepare(`SELECT COUNT(*) as cnt FROM events ${where}`).get(...params) as { cnt: number }).cnt;

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const rows = this.db.prepare(`
      SELECT id, type, contestant_id, data, timestamp
      FROM events ${where}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset) as Array<{
      id: string;
      type: string;
      contestant_id: string | null;
      data: string;
      timestamp: number;
    }>;

    const events: PlatformEvent[] = rows.map(r => ({
      id: r.id,
      type: r.type as EventType,
      ...(r.contestant_id ? { contestantId: r.contestant_id } : {}),
      data: JSON.parse(r.data) as Record<string, unknown>,
      timestamp: r.timestamp,
    }));

    return { events, total };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const eventLogger = new EventLoggerClass(globalDb);
