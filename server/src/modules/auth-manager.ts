// =============================================================================
// XTION_TheFool0 — AuthManager 模块
// Requirements: 1.1, 1.2, 1.3, 1.4
// =============================================================================

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Database as DatabaseType } from 'better-sqlite3';
import { db as globalDb } from '../db';
import type { Key, IAuthManager } from '../types';

// =============================================================================
// DB Row Type
// =============================================================================

interface KeyRow {
  id: string;
  key: string;
  contestant_name: string;
  status: 'active' | 'revoked';
  created_at: number;
  revoked_at: number | null;
}

function rowToKey(row: KeyRow): Key {
  return {
    id: row.id,
    key: row.key,
    contestantName: row.contestant_name,
    status: row.status,
    createdAt: row.created_at,
    ...(row.revoked_at != null ? { revokedAt: row.revoked_at } : {}),
  };
}

// =============================================================================
// AuthManager Implementation
// =============================================================================

export class AuthManagerClass implements IAuthManager {
  private db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * 生成新的 API Key（64字符 hex，≥32字符）
   * Requirements: 1.1, 1.2
   */
  async generateKey(contestantName: string): Promise<Key> {
    const id = uuidv4();
    const key = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO keys (id, key, contestant_name, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, key, contestantName, now);

    return {
      id,
      key,
      contestantName,
      status: 'active',
      createdAt: now,
    };
  }

  /**
   * 验证 Key 是否有效（存在且状态为 active）
   * Requirements: 1.3, 1.4
   */
  async validateKey(key: string): Promise<{ valid: boolean; contestantId?: string }> {
    const row = this.db.prepare(`
      SELECT id, status FROM keys WHERE key = ?
    `).get(key) as { id: string; status: string } | undefined;

    if (!row || row.status !== 'active') {
      return { valid: false };
    }

    return { valid: true, contestantId: row.id };
  }

  /**
   * 吊销 Key（将状态改为 revoked）
   * Requirements: 1.2
   */
  async revokeKey(keyId: string): Promise<void> {
    const result = this.db.prepare(`
      UPDATE keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'
    `).run(Date.now(), keyId);

    if (result.changes === 0) {
      throw new Error(`Key not found or already revoked: ${keyId}`);
    }
  }

  /**
   * 重新生成 Key（生成新的 key 字符串，保留 id 和 contestantName）
   * Requirements: 1.2
   */
  async regenerateKey(keyId: string): Promise<Key> {
    const existing = this.db.prepare(`
      SELECT * FROM keys WHERE id = ?
    `).get(keyId) as KeyRow | undefined;

    if (!existing) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const newKey = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.db.prepare(`
      UPDATE keys SET key = ?, status = 'active', revoked_at = NULL, created_at = ? WHERE id = ?
    `).run(newKey, now, keyId);

    return {
      id: existing.id,
      key: newKey,
      contestantName: existing.contestant_name,
      status: 'active',
      createdAt: now,
    };
  }

  /**
   * 获取所有 Key 列表
   * Requirements: 1.2
   */
  async listKeys(): Promise<Key[]> {
    const rows = this.db.prepare(`
      SELECT * FROM keys ORDER BY created_at DESC
    `).all() as KeyRow[];

    return rows.map(rowToKey);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const authManager = new AuthManagerClass(globalDb);
