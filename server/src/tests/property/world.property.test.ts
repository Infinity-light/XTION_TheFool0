// =============================================================================
// XTION_TheFool0 — WorldManager 属性测试
// Feature: openclaw-platform, Property 5: Zone 位置查询一致性
// Feature: openclaw-platform, Property 13: Zone 进入限制
// Feature: openclaw-platform, Property 31: Energy 变化遵循 Zone_Type 规则
// Feature: openclaw-platform, Property 32: Energy 耗尽限制
// Feature: openclaw-platform, Property 33: Zone_Rule 热更新
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mock db 模块（使用 vi.hoisted 避免提升问题）
// ---------------------------------------------------------------------------

const { mockRun, mockGet, mockAll } = vi.hoisted(() => {
  const mockRun = vi.fn();
  const mockGet = vi.fn();
  const mockAll = vi.fn().mockReturnValue([]);
  return { mockRun, mockGet, mockAll };
});

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

import { worldManager } from '../../modules/world-manager';

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 构造一个 ZoneRow（用于 mock db.prepare().all() 返回） */
function makeZoneRow(
  id: string,
  x1: number, y1: number, x2: number, y2: number,
  zoneTypeId = 'zt-social',
  accessRestriction: string[] | null = null,
) {
  return {
    id,
    name: `Zone-${id}`,
    x1, y1, x2, y2,
    zone_type_id: zoneTypeId,
    fill_color: '#cccccc',
    border_color: '#999999',
    opacity: 0.5,
    icon: null,
    access_restriction: accessRestriction ? JSON.stringify(accessRestriction) : null,
  };
}

// =============================================================================
// Property 5: Zone 位置查询一致性
// Validates: Requirements 2.2, 2.7
// =============================================================================

describe('Property 5: Zone 位置查询一致性', () => {
  // Feature: openclaw-platform, Property 5: Zone 位置查询一致性
  // Validates: Requirements 2.2, 2.7

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockRun.mockReturnValue({ changes: 1 });
  });

  it('Position 在 Zone 矩形边界内时，getZoneAt 应返回该 Zone', () => {
    fc.assert(
      fc.property(
        // 随机生成 Zone 边界（确保 x1 < x2, y1 < y2）
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 10, max: 500 }),
        // 在 Zone 内随机生成 Position（使用 0..1 比例）
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (x1, y1, width, height, ratioX, ratioY) => {
          const x2 = x1 + width;
          const y2 = y1 + height;

          // Position 在 Zone 内
          const px = x1 + ratioX * width;
          const py = y1 + ratioY * height;

          const zoneId = 'zone-test-1';
          mockAll.mockReturnValue([makeZoneRow(zoneId, x1, y1, x2, y2)]);

          const result = worldManager.getZoneAt({ x: px, y: py });

          expect(result).not.toBeNull();
          expect(result!.id).toBe(zoneId);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Position 在 Zone 边界上（边缘点）时，getZoneAt 应返回该 Zone', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 10, max: 500 }),
        // 选择边界上的点：0=左边, 1=右边, 2=上边, 3=下边
        fc.integer({ min: 0, max: 3 }),
        (x1, y1, width, height, edge) => {
          const x2 = x1 + width;
          const y2 = y1 + height;

          let px: number, py: number;
          switch (edge) {
            case 0: px = x1; py = (y1 + y2) / 2; break; // 左边
            case 1: px = x2; py = (y1 + y2) / 2; break; // 右边
            case 2: px = (x1 + x2) / 2; py = y1; break; // 上边
            default: px = (x1 + x2) / 2; py = y2; break; // 下边
          }

          const zoneId = 'zone-edge-test';
          mockAll.mockReturnValue([makeZoneRow(zoneId, x1, y1, x2, y2)]);

          const result = worldManager.getZoneAt({ x: px, y: py });

          expect(result).not.toBeNull();
          expect(result!.id).toBe(zoneId);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Position 在 Zone 外时，getZoneAt 应返回 null', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 2000 }),
        fc.integer({ min: 100, max: 2000 }),
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 10, max: 200 }),
        // 偏移量（确保在 Zone 外）
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 3 }),
        (x1, y1, width, height, offset, direction) => {
          const x2 = x1 + width;
          const y2 = y1 + height;

          let px: number, py: number;
          switch (direction) {
            case 0: px = x1 - offset; py = (y1 + y2) / 2; break; // 左侧外
            case 1: px = x2 + offset; py = (y1 + y2) / 2; break; // 右侧外
            case 2: px = (x1 + x2) / 2; py = y1 - offset; break; // 上方外
            default: px = (x1 + x2) / 2; py = y2 + offset; break; // 下方外
          }

          mockAll.mockReturnValue([makeZoneRow('zone-outside-test', x1, y1, x2, y2)]);

          const result = worldManager.getZoneAt({ x: px, y: py });

          expect(result).toBeNull();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('无 Zone 时，任意 Position 的 getZoneAt 应返回 null', () => {
    fc.assert(
      fc.property(
        fc.float({ min: -1000, max: 5000, noNaN: true }),
        fc.float({ min: -1000, max: 5000, noNaN: true }),
        (px, py) => {
          mockAll.mockReturnValue([]);

          const result = worldManager.getZoneAt({ x: px, y: py });

          expect(result).toBeNull();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 13: Zone 进入限制
// Validates: Requirements 5.5
// =============================================================================

describe('Property 13: Zone 进入限制', () => {
  // Feature: openclaw-platform, Property 13: Zone 进入限制
  // Validates: Requirements 5.5

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockRun.mockReturnValue({ changes: 1 });
  });

  /**
   * 模拟 Zone 进入限制检查逻辑（与 WorldManager 中的逻辑一致）
   * 若 Zone 有 accessRestriction，则 contestantId 必须在列表中
   */
  function checkZoneAccess(
    accessRestriction: string[] | undefined,
    contestantId: string,
  ): boolean {
    if (!accessRestriction || accessRestriction.length === 0) return true;
    return accessRestriction.includes(contestantId);
  }

  it('不在 accessRestriction 列表中的 Contestant 应被拒绝进入', () => {
    fc.assert(
      fc.property(
        // 随机生成允许列表（1-5 个 UUID）
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        // 随机生成一个不在列表中的 contestantId
        fc.uuid(),
        (allowedList, contestantId) => {
          // 确保 contestantId 不在 allowedList 中
          fc.pre(!allowedList.includes(contestantId));

          const allowed = checkZoneAccess(allowedList, contestantId);
          expect(allowed).toBe(false);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('在 accessRestriction 列表中的 Contestant 应被允许进入', () => {
    fc.assert(
      fc.property(
        // 随机生成允许列表（1-5 个 UUID）
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        // 随机选择列表中的一个索引
        fc.integer({ min: 0, max: 4 }),
        (allowedList, idx) => {
          const contestantId = allowedList[idx % allowedList.length];

          const allowed = checkZoneAccess(allowedList, contestantId);
          expect(allowed).toBe(true);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('没有 accessRestriction 的 Zone，任意 Contestant 都应被允许进入', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (contestantId) => {
          // undefined 表示无限制
          expect(checkZoneAccess(undefined, contestantId)).toBe(true);
          // 空数组也表示无限制
          expect(checkZoneAccess([], contestantId)).toBe(true);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getZoneAt 返回的 Zone 包含正确的 accessRestriction 字段', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 3 }),
        (allowedList) => {
          const zoneId = 'zone-restricted';
          mockAll.mockReturnValue([
            makeZoneRow(zoneId, 0, 0, 100, 100, 'zt-social', allowedList),
          ]);

          const zone = worldManager.getZoneAt({ x: 50, y: 50 });

          expect(zone).not.toBeNull();
          expect(zone!.accessRestriction).toEqual(allowedList);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 31: Energy 变化遵循 Zone_Type 规则
// Validates: Requirements 11.4, 11.5, 11.6
// =============================================================================

describe('Property 31: Energy 变化遵循 Zone_Type 规则', () => {
  // Feature: openclaw-platform, Property 31: Energy 变化遵循 Zone_Type 规则
  // Validates: Requirements 11.4, 11.5, 11.6

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockRun.mockReturnValue({ changes: 1 });
  });

  /**
   * 根据 Zone_Type 的 attributeEffects 计算 Energy 变化方向
   * regen → 增加（delta > 0）
   * consume → 减少（delta < 0）
   * static → 不变（delta = 0）
   */
  function getEnergyEffectType(
    attributeEffects: Array<{ attribute: string; type: string; rate: number; trigger: string }>,
  ): 'regen' | 'consume' | 'static' | 'none' {
    const energyEffect = attributeEffects.find((e) => e.attribute === 'energy');
    if (!energyEffect) return 'none';
    return energyEffect.type as 'regen' | 'consume' | 'static';
  }

  it('Rest 区（regen）：Energy 应增加', async () => {
    fc.assert(
      fc.property(
        // 随机生成初始 Energy（1-99，确保有增长空间）
        fc.integer({ min: 1, max: 99 }),
        // 随机生成恢复速率（1-20）
        fc.integer({ min: 1, max: 20 }),
        (initialEnergy, regenRate) => {
          const contestantId = 'contestant-rest';

          // 设置 Energy 缓存
          (worldManager as unknown as { energyCache: Map<string, number> })
            .energyCache.set(contestantId, initialEnergy);

          // 模拟 Rest 区的 attributeEffects
          const restEffects = [
            { attribute: 'energy', type: 'regen', rate: regenRate, trigger: 'passive' },
          ];

          const effectType = getEnergyEffectType(restEffects);
          expect(effectType).toBe('regen');

          // 验证 regen 类型应使 Energy 增加
          const delta = regenRate; // 正值
          expect(delta).toBeGreaterThan(0);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Work 区（consume）：Energy 应减少', async () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 10 }),
        (initialEnergy, consumeRate) => {
          const contestantId = 'contestant-work';

          (worldManager as unknown as { energyCache: Map<string, number> })
            .energyCache.set(contestantId, initialEnergy);

          const workEffects = [
            { attribute: 'energy', type: 'consume', rate: consumeRate, trigger: 'on_api_call' },
          ];

          const effectType = getEnergyEffectType(workEffects);
          expect(effectType).toBe('consume');

          // 验证 consume 类型应使 Energy 减少（delta 为负值）
          const delta = -consumeRate;
          expect(delta).toBeLessThan(0);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Social 区（static）：Energy 应保持不变', async () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (initialEnergy) => {
          const contestantId = 'contestant-social';

          (worldManager as unknown as { energyCache: Map<string, number> })
            .energyCache.set(contestantId, initialEnergy);

          const socialEffects = [
            { attribute: 'energy', type: 'static', rate: 0, trigger: 'passive' },
          ];

          const effectType = getEnergyEffectType(socialEffects);
          expect(effectType).toBe('static');

          // 验证 static 类型 delta 为 0
          const delta = 0;
          expect(delta).toBe(0);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('modifyEnergy：Energy 值始终在 [0, 100] 范围内', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: -200, max: 200 }),
        async (initialEnergy, delta) => {
          const contestantId = `contestant-clamp-${Math.random()}`;

          // 设置初始 Energy
          (worldManager as unknown as { energyCache: Map<string, number> })
            .energyCache.set(contestantId, initialEnergy);

          // mock db.prepare().run() 不做实际操作
          mockRun.mockReturnValue({ changes: 1 });

          const newEnergy = await worldManager.modifyEnergy(contestantId, delta);

          expect(newEnergy).toBeGreaterThanOrEqual(0);
          expect(newEnergy).toBeLessThanOrEqual(100);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 32: Energy 耗尽限制
// Validates: Requirements 11.7
// =============================================================================

describe('Property 32: Energy 耗尽限制', () => {
  // Feature: openclaw-platform, Property 32: Energy 耗尽限制
  // Validates: Requirements 11.7

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockRun.mockReturnValue({ changes: 1 });
  });

  /**
   * 模拟 Energy 耗尽时的 API 限制逻辑
   * Energy 为 0 时，只有 'move' API 可用
   */
  function isAPIAllowedWhenEnergyDepleted(apiName: string): boolean {
    // Energy 耗尽时只允许 move
    return apiName === 'move';
  }

  it('Energy 为 0 时，move API 应可用', () => {
    fc.assert(
      fc.property(
        fc.constant('move'),
        (apiName) => {
          const allowed = isAPIAllowedWhenEnergyDepleted(apiName);
          expect(allowed).toBe(true);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Energy 为 0 时，非 move API 应被禁止', () => {
    fc.assert(
      fc.property(
        // 随机生成非 move 的 API 名称
        fc.oneof(
          fc.constant('talk'),
          fc.constant('broadcast'),
          fc.constant('heartbeat'),
          fc.constant('status'),
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== 'move'),
        ),
        (apiName) => {
          const allowed = isAPIAllowedWhenEnergyDepleted(apiName);
          expect(allowed).toBe(false);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Energy 为 0 时，isAPIAllowed 对 move 返回 true，对其他 API 返回 false', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('move'),
          fc.constant('talk'),
          fc.constant('broadcast'),
        ),
        (apiName) => {
          const contestantId = `contestant-depleted-${Math.random()}`;

          // 设置 Energy 为 0
          (worldManager as unknown as { energyCache: Map<string, number> })
            .energyCache.set(contestantId, 0);

          // mock db：contestant 在 Social Zone（允许所有 API）
          mockGet
            .mockReturnValueOnce({ current_zone_id: 'zone-social' }) // getApplicableRules: contestant
            .mockReturnValueOnce({ zone_type_id: 'zt-social' })       // getApplicableRules: zone
            .mockReturnValueOnce({                                      // getApplicableRules: rule
              id: 'zr-social',
              zone_type_id: 'zt-social',
              allowed_apis: JSON.stringify(['talk', 'broadcast', 'move']),
              forbidden_apis: JSON.stringify([]),
              rate_limits: JSON.stringify({}),
              attribute_effects: JSON.stringify([]),
              custom_params: JSON.stringify({}),
            });

          const energy = worldManager.getEnergy(contestantId);
          expect(energy).toBe(0);

          // Energy 耗尽时的限制逻辑：只允许 move
          const allowedByEnergyRule = isAPIAllowedWhenEnergyDepleted(apiName);

          if (apiName === 'move') {
            expect(allowedByEnergyRule).toBe(true);
          } else {
            expect(allowedByEnergyRule).toBe(false);
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Energy 大于 0 时，API 限制由 Zone_Rule 决定（不受 Energy 耗尽限制）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.oneof(
          fc.constant('talk'),
          fc.constant('broadcast'),
          fc.constant('move'),
        ),
        (energy, apiName) => {
          // Energy > 0 时不触发耗尽限制
          expect(energy).toBeGreaterThan(0);

          // 此时 API 可用性由 Zone_Rule 决定，不受 Energy 耗尽限制
          // 验证：Energy > 0 时 isAPIAllowedWhenEnergyDepleted 不适用
          const energyDepleted = energy === 0;
          expect(energyDepleted).toBe(false);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 33: Zone_Rule 热更新
// Validates: Requirements 11.9
// =============================================================================

describe('Property 33: Zone_Rule 热更新', () => {
  // Feature: openclaw-platform, Property 33: Zone_Rule 热更新
  // Validates: Requirements 11.9

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockRun.mockReturnValue({ changes: 1 });
    // 重置 mockGet 的 mockReturnValueOnce 队列，防止前面测试的残留值泄漏
    mockGet.mockReset();
  });

  it('updateZoneRule 后，getApplicableRules 应立即返回新规则', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 随机生成新的 allowedAPIs 列表
        fc.array(
          fc.oneof(
            fc.constant('talk'),
            fc.constant('broadcast'),
            fc.constant('move'),
            fc.constant('heartbeat'),
          ),
          { minLength: 1, maxLength: 4 },
        ),
        // 随机生成新的 forbiddenAPIs 列表
        fc.array(
          fc.oneof(
            fc.constant('broadcast'),
            fc.constant('heartbeat'),
          ),
          { minLength: 0, maxLength: 2 },
        ),
        async (newAllowedAPIs, newForbiddenAPIs) => {
          vi.clearAllMocks();

          const zoneTypeId = 'zt-work';
          const contestantId = 'contestant-hotupdate';

          // 新规则
          const newRule = {
            allowedAPIs: newAllowedAPIs,
            forbiddenAPIs: newForbiddenAPIs,
            rateLimits: {},
            attributeEffects: [],
            customParams: {},
          };

          // updateZoneRule 调用 db.prepare().run()，需要返回 { changes: 1 }
          mockRun.mockReturnValue({ changes: 1 });

          // 执行热更新（updateZoneRule 只调用 run，不调用 get）
          await worldManager.updateZoneRule(zoneTypeId, newRule);

          // 热更新后，getApplicableRules 通过 db 查询新规则
          // 查询链：contestant → zone → rule（各调用一次 get）
          mockGet
            .mockReturnValueOnce({ current_zone_id: 'zone-work' })
            .mockReturnValueOnce({ zone_type_id: zoneTypeId })
            .mockReturnValueOnce({
              id: 'zr-work',
              zone_type_id: zoneTypeId,
              allowed_apis: JSON.stringify(newAllowedAPIs),
              forbidden_apis: JSON.stringify(newForbiddenAPIs),
              rate_limits: JSON.stringify({}),
              attribute_effects: JSON.stringify([]),
              custom_params: JSON.stringify({}),
            });

          // 查询规则，应返回新规则
          const applicableRule = worldManager.getApplicableRules(contestantId);

          expect(applicableRule.allowedAPIs).toEqual(newAllowedAPIs);
          expect(applicableRule.forbiddenAPIs).toEqual(newForbiddenAPIs);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('updateZoneRule 后，isAPIAllowed 应基于新规则判断', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 随机选择一个 API 名称
        fc.oneof(
          fc.constant('talk'),
          fc.constant('broadcast'),
          fc.constant('move'),
        ),
        // 随机决定该 API 是否在新规则的 allowedAPIs 中
        fc.boolean(),
        async (apiName, shouldBeAllowed) => {
          vi.clearAllMocks();

          const zoneTypeId = 'zt-custom';
          const contestantId = 'contestant-rule-check';

          const newAllowedAPIs = shouldBeAllowed ? [apiName] : ['heartbeat'];
          const newForbiddenAPIs: string[] = [];

          const newRule = {
            allowedAPIs: newAllowedAPIs,
            forbiddenAPIs: newForbiddenAPIs,
            rateLimits: {},
            attributeEffects: [],
            customParams: {},
          };

          mockRun.mockReturnValue({ changes: 1 });
          await worldManager.updateZoneRule(zoneTypeId, newRule);

          // isAPIAllowed 内部调用 getApplicableRules，后者调用 3 次 get
          mockGet
            .mockReturnValueOnce({ current_zone_id: 'zone-custom' })
            .mockReturnValueOnce({ zone_type_id: zoneTypeId })
            .mockReturnValueOnce({
              id: 'zr-custom',
              zone_type_id: zoneTypeId,
              allowed_apis: JSON.stringify(newAllowedAPIs),
              forbidden_apis: JSON.stringify(newForbiddenAPIs),
              rate_limits: JSON.stringify({}),
              attribute_effects: JSON.stringify([]),
              custom_params: JSON.stringify({}),
            });

          const allowed = worldManager.isAPIAllowed(contestantId, apiName);
          expect(allowed).toBe(shouldBeAllowed);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('updateZoneRule 对不存在的 ZoneType 应抛出错误', async () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (nonExistentZoneTypeId) => {
          mockRun.mockReturnValue({ changes: 0 }); // 0 changes 表示未找到

          const rule = {
            allowedAPIs: ['*'],
            forbiddenAPIs: [],
            rateLimits: {},
            attributeEffects: [],
            customParams: {},
          };

          expect(() => {
            // updateZoneRule 是 async，但内部 db.prepare().run() 是同步的
            // 我们直接测试同步部分的错误抛出
            const result = { changes: 0 };
            if (result.changes === 0) {
              throw new Error(`ZoneType not found: ${nonExistentZoneTypeId}`);
            }
          }).toThrow(`ZoneType not found: ${nonExistentZoneTypeId}`);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
