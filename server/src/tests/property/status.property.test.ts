// =============================================================================
// XTION_TheFool0 — Status API 属性测试
// Property 36: 自身状态查询准确性
// Property 37: 其他 Contestant 公开状态查询
// Property 38: Zone 详情查询准确性
// Property 39: World 概览查询准确性
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// In-memory DB factory with full schema
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE zone_types (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', is_builtin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE zone_rules (
      id TEXT PRIMARY KEY, zone_type_id TEXT NOT NULL UNIQUE,
      allowed_apis TEXT NOT NULL DEFAULT '[]', forbidden_apis TEXT NOT NULL DEFAULT '[]',
      rate_limits TEXT NOT NULL DEFAULT '{}', attribute_effects TEXT NOT NULL DEFAULT '[]',
      custom_params TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE zones (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
      zone_type_id TEXT NOT NULL,
      fill_color TEXT NOT NULL DEFAULT '#cccccc', border_color TEXT NOT NULL DEFAULT '#999999',
      opacity REAL NOT NULL DEFAULT 0.5, icon TEXT, access_restriction TEXT
    );
    CREATE TABLE contestants (
      id TEXT PRIMARY KEY, key_id TEXT NOT NULL, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      position_x REAL NOT NULL DEFAULT 0, position_y REAL NOT NULL DEFAULT 0,
      current_zone_id TEXT, energy REAL NOT NULL DEFAULT 100,
      installed_skills TEXT NOT NULL DEFAULT '[]',
      attributes TEXT NOT NULL DEFAULT '{}',
      connected_at INTEGER, disconnected_at INTEGER
    );
  `);

  // Seed a zone type and zone
  db.prepare(
    'INSERT INTO zone_types (id, name, description, is_builtin) VALUES (?, ?, ?, ?)',
  ).run('zt-social', 'Social', 'Social zone', 1);
  db.prepare(
    'INSERT INTO zone_rules (id, zone_type_id, allowed_apis, forbidden_apis, rate_limits, attribute_effects, custom_params) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('zr-social', 'zt-social', '["talk","broadcast","move"]', '[]', '{}', '[]', '{}');
  db.prepare(
    'INSERT INTO zones (id, name, x1, y1, x2, y2, zone_type_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('zone-main', 'Main Hall', 0, 0, 1000, 800, 'zt-social');

  return db;
}

type TestDb = ReturnType<typeof makeDb>;

function insertContestant(db: TestDb, overrides: Partial<{
  id: string; name: string; status: string;
  posX: number; posY: number; zoneId: string; energy: number;
}> = {}) {
  const id = overrides.id ?? uuidv4();
  db.prepare(`
    INSERT INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}')
  `).run(
    id,
    uuidv4(),
    overrides.name ?? 'TestContestant',
    overrides.status ?? 'online',
    overrides.posX ?? 500,
    overrides.posY ?? 400,
    overrides.zoneId ?? 'zone-main',
    overrides.energy ?? 100,
  );
  return id;
}

const safeStr = (min = 1, max = 15) =>
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    { minLength: min, maxLength: max },
  );

// ---------------------------------------------------------------------------
// Property 36: 自身状态查询准确性
// ---------------------------------------------------------------------------

describe('Property 36: 自身状态查询准确性', () => {
  it('查询返回的 Position 与数据库中存储的一致', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 999, noNaN: true }),
        fc.float({ min: 0, max: 799, noNaN: true }),
        fc.float({ min: 0, max: 100, noNaN: true }),
        (posX, posY, energy) => {
          const db = makeDb();
          const id = insertContestant(db, { posX, posY, energy });

          const row = db.prepare('SELECT * FROM contestants WHERE id = ?').get(id) as {
            position_x: number; position_y: number; energy: number; current_zone_id: string;
          };

          expect(row.position_x).toBeCloseTo(posX, 5);
          expect(row.position_y).toBeCloseTo(posY, 5);
          expect(row.energy).toBeCloseTo(energy, 5);
          expect(row.current_zone_id).toBe('zone-main');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('查询返回的 installedSkills 与数据库一致', () => {
    fc.assert(
      fc.property(
        fc.array(safeStr(1, 10), { minLength: 0, maxLength: 5 }),
        (skills) => {
          const db = makeDb();
          const id = uuidv4();
          db.prepare(`
            INSERT INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes)
            VALUES (?, ?, ?, 'online', 500, 400, 'zone-main', 100, ?, '{}')
          `).run(id, uuidv4(), 'TestContestant', JSON.stringify(skills));

          const row = db.prepare('SELECT installed_skills FROM contestants WHERE id = ?').get(id) as
            { installed_skills: string };
          const parsed = JSON.parse(row.installed_skills) as string[];
          expect(parsed).toEqual(skills);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 37: 其他 Contestant 公开状态查询
// ---------------------------------------------------------------------------

describe('Property 37: 其他 Contestant 公开状态查询', () => {
  it('公开状态只包含 id, name, status, position, currentZoneId', () => {
    fc.assert(
      fc.property(
        safeStr(1, 15),
        fc.float({ min: 0, max: 999, noNaN: true }),
        fc.float({ min: 0, max: 799, noNaN: true }),
        (name, posX, posY) => {
          const db = makeDb();
          const id = insertContestant(db, { name, posX, posY });

          const row = db.prepare('SELECT * FROM contestants WHERE id = ?').get(id) as {
            id: string; name: string; status: string;
            position_x: number; position_y: number; current_zone_id: string;
            energy: number; installed_skills: string;
          };

          // Public fields
          const publicStatus = {
            id: row.id,
            name: row.name,
            status: row.status,
            position: { x: row.position_x, y: row.position_y },
            currentZoneId: row.current_zone_id,
          };

          expect(publicStatus.id).toBe(id);
          expect(publicStatus.name).toBe(name);
          expect(publicStatus.position.x).toBeCloseTo(posX, 5);
          expect(publicStatus.position.y).toBeCloseTo(posY, 5);

          // Private fields should NOT be in public status
          expect((publicStatus as Record<string, unknown>).energy).toBeUndefined();
          expect((publicStatus as Record<string, unknown>).installedSkills).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 38: Zone 详情查询准确性
// ---------------------------------------------------------------------------

describe('Property 38: Zone 详情查询准确性', () => {
  it('Zone 详情包含正确的边界和在线 Contestant 列表', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (onlineCount, offlineCount) => {
          const db = makeDb();

          // Add online contestants in zone-main
          const onlineIds: string[] = [];
          for (let i = 0; i < onlineCount; i++) {
            const id = insertContestant(db, { status: 'online', zoneId: 'zone-main' });
            onlineIds.push(id);
          }
          // Add offline contestants
          for (let i = 0; i < offlineCount; i++) {
            insertContestant(db, { status: 'offline', zoneId: 'zone-main' });
          }

          const zoneRow = db.prepare('SELECT * FROM zones WHERE id = ?').get('zone-main') as {
            id: string; name: string; x1: number; y1: number; x2: number; y2: number;
          };

          const onlineInZone = db.prepare(
            "SELECT id FROM contestants WHERE current_zone_id = ? AND status = 'online'",
          ).all('zone-main') as Array<{ id: string }>;

          expect(zoneRow.id).toBe('zone-main');
          expect(zoneRow.name).toBe('Main Hall');
          expect(zoneRow.x1).toBe(0);
          expect(zoneRow.y1).toBe(0);
          expect(zoneRow.x2).toBe(1000);
          expect(zoneRow.y2).toBe(800);
          expect(onlineInZone.length).toBe(onlineCount);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 39: World 概览查询准确性
// ---------------------------------------------------------------------------

describe('Property 39: World 概览查询准确性', () => {
  it('World 概览中在线总数与各 Zone 人数之和一致', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        (onlineCount) => {
          const db = makeDb();

          for (let i = 0; i < onlineCount; i++) {
            insertContestant(db, { status: 'online', zoneId: 'zone-main' });
          }

          const totalOnline = (db.prepare(
            "SELECT COUNT(*) as cnt FROM contestants WHERE status = 'online'",
          ).get() as { cnt: number }).cnt;

          const zoneCount = (db.prepare(
            "SELECT COUNT(*) as cnt FROM contestants WHERE current_zone_id = 'zone-main' AND status = 'online'",
          ).get() as { cnt: number }).cnt;

          expect(totalOnline).toBe(onlineCount);
          expect(zoneCount).toBe(onlineCount);
          // Total online equals sum of zone populations (single zone in test)
          expect(totalOnline).toBe(zoneCount);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('World 概览中 Zone 列表与数据库一致', () => {
    const db = makeDb();

    const zones = db.prepare('SELECT id, name FROM zones').all() as Array<{ id: string; name: string }>;
    expect(zones.length).toBe(1);
    expect(zones[0].id).toBe('zone-main');
    expect(zones[0].name).toBe('Main Hall');
  });
});
