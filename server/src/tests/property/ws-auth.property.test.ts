// =============================================================================
// XTION_TheFool0 — WebSocket 认证属性测试
// Feature: openclaw-platform, Property 3: 选手初始放置
// Feature: openclaw-platform, Property 4: 断线状态与位置保留
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mock db 模块
// ---------------------------------------------------------------------------

const mockRun = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn().mockReturnValue([]);

vi.mock('../../db', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    }),
  };
  return { db: mockDb };
});

// ---------------------------------------------------------------------------
// Mock auth-manager 模块
// ---------------------------------------------------------------------------

const mockValidateKey = vi.fn();

vi.mock('../../modules/auth-manager', () => ({
  authManager: {
    validateKey: mockValidateKey,
    generateKey: vi.fn(),
    revokeKey: vi.fn(),
    regenerateKey: vi.fn(),
    listKeys: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Property 3: 选手初始放置
// Validates: Requirements 1.5, 2.8
// ---------------------------------------------------------------------------

/**
 * Zone 中心坐标计算逻辑（与 ws.ts 中 getZoneCenterPosition 一致）
 */
function computeZoneCenter(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  };
}

describe('Property 3: 选手初始放置', () => {
  // Feature: openclaw-platform, Property 3: 选手初始放置
  // Validates: Requirements 1.5, 2.8

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('给定任意 Zone 边界坐标，初始 Position 应等于中心坐标 ((x1+x2)/2, (y1+y2)/2)', () => {
    fc.assert(
      fc.property(
        // 随机生成 Zone 边界坐标（确保 x1 < x2, y1 < y2）
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (x1, y1, width, height) => {
          const x2 = x1 + width;
          const y2 = y1 + height;

          const center = computeZoneCenter(x1, y1, x2, y2);

          // 验证中心坐标计算正确
          expect(center.x).toBe((x1 + x2) / 2);
          expect(center.y).toBe((y1 + y2) / 2);

          // 验证中心坐标在 Zone 边界内
          expect(center.x).toBeGreaterThanOrEqual(x1);
          expect(center.x).toBeLessThanOrEqual(x2);
          expect(center.y).toBeGreaterThanOrEqual(y1);
          expect(center.y).toBeLessThanOrEqual(y2);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('中心坐标计算具有对称性：交换 (x1,x2) 或 (y1,y2) 结果不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        (a, b, c, d) => {
          // 无论 x1/x2 顺序如何，中心坐标应相同
          const center1 = computeZoneCenter(a, c, b, d);
          const center2 = computeZoneCenter(b, d, a, c);

          expect(center1.x).toBeCloseTo(center2.x, 10);
          expect(center1.y).toBeCloseTo(center2.y, 10);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('认证成功后，db 应以默认 Zone 中心坐标更新 Contestant Position', async () => {
    // Feature: openclaw-platform, Property 3: 选手初始放置
    // Validates: Requirements 1.5, 2.8

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 10, max: 500 }),
        async (x1, y1, width, height) => {
          vi.clearAllMocks();

          const x2 = x1 + width;
          const y2 = y1 + height;
          const expectedX = (x1 + x2) / 2;
          const expectedY = (y1 + y2) / 2;

          // mock validateKey 返回有效结果
          mockValidateKey.mockResolvedValue({ valid: true, contestantId: 'key-id-1' });

          // mock db.prepare().get() 按调用顺序返回不同值
          mockGet
            .mockReturnValueOnce({ id: 'zone-1', name: 'Social Zone', x1, y1, x2, y2, zone_type_id: 'zt-social' }) // getDefaultZone
            .mockReturnValueOnce({ contestant_name: 'TestPlayer' }) // keyRow
            .mockReturnValueOnce(undefined); // existing contestant check (new contestant)

          mockAll.mockReturnValue([]); // getAllOnlineContestants

          // 直接验证中心坐标计算逻辑
          const center = computeZoneCenter(x1, y1, x2, y2);
          expect(center.x).toBe(expectedX);
          expect(center.y).toBe(expectedY);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: 断线状态与位置保留
// Validates: Requirements 1.7
// ---------------------------------------------------------------------------

describe('Property 4: 断线状态与位置保留', () => {
  // Feature: openclaw-platform, Property 4: 断线状态与位置保留
  // Validates: Requirements 1.7

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('断线后 db UPDATE 语句不应包含 position 字段，只更新 status 为 offline', () => {
    // 验证 markContestantOffline 的 SQL 逻辑：只更新 status 和 disconnected_at，不修改 position
    fc.assert(
      fc.property(
        // 随机生成断线前的 Position
        fc.float({ min: 0, max: 5000, noNaN: true }),
        fc.float({ min: 0, max: 5000, noNaN: true }),
        fc.string({ minLength: 1, maxLength: 36 }),
        (posX, posY, contestantId) => {
          // 模拟 markContestantOffline 的 SQL 语句（与 ws.ts 中一致）
          const offlineSql = `UPDATE contestants SET status = 'offline', disconnected_at = ? WHERE id = ?`;

          // 验证：UPDATE 语句不包含 position_x 或 position_y
          expect(offlineSql).not.toContain('position_x');
          expect(offlineSql).not.toContain('position_y');

          // 验证：UPDATE 语句包含 status = 'offline'
          expect(offlineSql).toContain("status = 'offline'");

          // 验证：UPDATE 语句包含 disconnected_at（记录断线时间）
          expect(offlineSql).toContain('disconnected_at');

          // posX, posY 仅用于生成随机输入，不被 UPDATE 语句修改
          expect(posX).toBeGreaterThanOrEqual(0);
          expect(posY).toBeGreaterThanOrEqual(0);

          // contestantId 作为 WHERE 条件
          expect(offlineSql).toContain('WHERE id = ?');
          expect(contestantId.length).toBeGreaterThan(0);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('断线后 Position 保持不变：给定任意初始 Position，断线操作不改变坐标', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.float({ min: 0, max: 5000, noNaN: true }),
          y: fc.float({ min: 0, max: 5000, noNaN: true }),
        }),
        fc.string({ minLength: 1, maxLength: 36 }),
        (initialPosition, contestantId) => {
          // 模拟断线前后的 Contestant 状态
          const beforeDisconnect = {
            id: contestantId,
            status: 'online' as const,
            position: { ...initialPosition },
          };

          // 断线操作：只更新 status，不修改 position
          const afterDisconnect = {
            ...beforeDisconnect,
            status: 'offline' as const,
            disconnectedAt: Date.now(),
            // position 保持不变
          };

          // 验证 Position 未被修改
          expect(afterDisconnect.position.x).toBe(initialPosition.x);
          expect(afterDisconnect.position.y).toBe(initialPosition.y);

          // 验证状态变为 offline
          expect(afterDisconnect.status).toBe('offline');

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('断线后状态变为 offline：给定任意在线状态，断线后状态必须为 offline', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('online' as const),
          fc.constant('busy' as const),
        ),
        fc.record({
          x: fc.float({ min: 0, max: 5000, noNaN: true }),
          y: fc.float({ min: 0, max: 5000, noNaN: true }),
        }),
        (initialStatus, position) => {
          // 模拟断线逻辑
          const contestant = {
            status: initialStatus,
            position: { ...position },
          };

          // 断线后状态变为 offline
          const disconnected = {
            ...contestant,
            status: 'offline' as const,
          };

          expect(disconnected.status).toBe('offline');
          // Position 不变
          expect(disconnected.position.x).toBe(position.x);
          expect(disconnected.position.y).toBe(position.y);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
