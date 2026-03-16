// =============================================================================
// XTION_TheFool0 — API 基础设施属性测试
// Feature: openclaw-platform, Property 22: 全局 API 速率限制
// Validates: Requirements 8.11
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { rateLimiter } from '../../modules/rate-limiter';

// =============================================================================
// Property 22: 全局 API 速率限制
// Validates: Requirements 8.11
// =============================================================================

describe('Property 22: 全局 API 速率限制', () => {
  beforeEach(() => {
    rateLimiter.resetAll();
  });

  it('超过 60 次/分钟后 checkGlobalLimit 应返回 false', () => {
    // Feature: openclaw-platform, Property 22: 全局 API 速率限制
    // Validates: Requirements 8.11
    fc.assert(
      fc.property(
        // 随机生成 contestantId
        fc.uuid(),
        // 随机生成超出限制的额外请求次数（1-20）
        fc.integer({ min: 1, max: 20 }),
        (contestantId, extraRequests) => {
          rateLimiter.reset(contestantId);
          const limit = rateLimiter.getGlobalLimit(); // 默认 60

          // 发送恰好 limit 次请求，全部应被允许
          for (let i = 0; i < limit; i++) {
            const allowed = rateLimiter.checkGlobalLimit(contestantId);
            if (!allowed) return false; // 前 60 次应全部通过
          }

          // 超出限制的请求应全部被拒绝
          for (let i = 0; i < extraRequests; i++) {
            const allowed = rateLimiter.checkGlobalLimit(contestantId);
            if (allowed) return false; // 超限后不应通过
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不同 Contestant 的速率限制相互独立', () => {
    // Feature: openclaw-platform, Property 22: 全局 API 速率限制
    // Validates: Requirements 8.11
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (idA, idB) => {
          // 确保两个 ID 不同
          if (idA === idB) return true;

          rateLimiter.reset(idA);
          rateLimiter.reset(idB);

          const limit = rateLimiter.getGlobalLimit();

          // 耗尽 idA 的配额
          for (let i = 0; i < limit; i++) {
            rateLimiter.checkGlobalLimit(idA);
          }

          // idA 超限
          const aBlocked = !rateLimiter.checkGlobalLimit(idA);
          // idB 不受影响，仍可通过
          const bAllowed = rateLimiter.checkGlobalLimit(idB);

          return aBlocked && bAllowed;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('在限制次数内的请求全部应被允许', () => {
    // Feature: openclaw-platform, Property 22: 全局 API 速率限制
    // Validates: Requirements 8.11
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 60 }),
        (contestantId, requestCount) => {
          rateLimiter.reset(contestantId);

          // 发送 requestCount 次（≤60），全部应被允许
          for (let i = 0; i < requestCount; i++) {
            const allowed = rateLimiter.checkGlobalLimit(contestantId);
            if (!allowed) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('setGlobalLimit 修改后新限制立即生效', () => {
    // Feature: openclaw-platform, Property 22: 全局 API 速率限制
    // Validates: Requirements 8.11
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 5, max: 30 }),
        (contestantId, customLimit) => {
          rateLimiter.reset(contestantId);
          rateLimiter.setGlobalLimit(customLimit);

          // 发送 customLimit 次，全部应通过
          for (let i = 0; i < customLimit; i++) {
            const allowed = rateLimiter.checkGlobalLimit(contestantId);
            if (!allowed) {
              rateLimiter.setGlobalLimit(60); // 恢复默认
              return false;
            }
          }

          // 第 customLimit+1 次应被拒绝
          const blocked = !rateLimiter.checkGlobalLimit(contestantId);
          rateLimiter.setGlobalLimit(60); // 恢复默认
          return blocked;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// 额外：Broadcast 频率限制测试
// Validates: Requirements 4.5
// =============================================================================

describe('Broadcast 频率限制', () => {
  beforeEach(() => {
    rateLimiter.resetAll();
    rateLimiter.setBroadcastLimit(5); // 确保默认值
  });

  it('超过 Broadcast 限制后应返回 false', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        (contestantId, extraRequests) => {
          rateLimiter.reset(contestantId);
          const limit = rateLimiter.getBroadcastLimit(); // 默认 5

          // 发送恰好 limit 次，全部应通过
          for (let i = 0; i < limit; i++) {
            const allowed = rateLimiter.checkBroadcastLimit(contestantId);
            if (!allowed) return false;
          }

          // 超出限制的请求应被拒绝
          for (let i = 0; i < extraRequests; i++) {
            const allowed = rateLimiter.checkBroadcastLimit(contestantId);
            if (allowed) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// 额外：Talk 频率限制测试
// Validates: Requirements 3.8
// =============================================================================

describe('Talk 频率限制（Zone_Rule 配置）', () => {
  beforeEach(() => {
    rateLimiter.resetAll();
  });

  it('超过 Zone_Rule 配置的 Talk 限制后应返回 false', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 3, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        (contestantId, talkLimit, extraRequests) => {
          rateLimiter.reset(contestantId);

          // 发送恰好 talkLimit 次，全部应通过
          for (let i = 0; i < talkLimit; i++) {
            const allowed = rateLimiter.checkTalkLimit(contestantId, talkLimit);
            if (!allowed) return false;
          }

          // 超出限制的请求应被拒绝
          for (let i = 0; i < extraRequests; i++) {
            const allowed = rateLimiter.checkTalkLimit(contestantId, talkLimit);
            if (allowed) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
