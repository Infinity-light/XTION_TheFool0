// =============================================================================
// XTION_TheFool0 — SkillDocManager 属性测试
// Property 16: Skill 文档 Metadata 验证
// Property 17: Skill 文档 CRUD 往返
// Property 18: Skill 文档版本回滚往返
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { SkillDocManagerClass } from '../../modules/skill-doc-manager';

// ---------------------------------------------------------------------------
// Use in-memory SQLite for isolation
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE skill_documents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', homepage TEXT, author TEXT,
      tags TEXT NOT NULL DEFAULT '[]', markdown_content TEXT NOT NULL DEFAULT '',
      current_version TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE document_versions (
      id TEXT PRIMARY KEY, skill_doc_id TEXT NOT NULL, version TEXT NOT NULL,
      markdown_content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      changelog TEXT
    );
  `);
  return db;
}

function makeManager() {
  return new SkillDocManagerClass(makeDb());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(name: string, version: string, description: string, extra = '') {
  return `---\nname: ${name}\nversion: ${version}\ndescription: ${description}\n---\n\n${extra}`;
}

// ---------------------------------------------------------------------------
// Safe string arbitrary: alphanumeric only, no YAML special chars
// ---------------------------------------------------------------------------

const safeStr = (min = 1, max = 20) =>
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')), { minLength: min, maxLength: max });



describe('Property 16: Skill 文档 Metadata 验证', () => {
  it('包含所有必填字段时验证通过', () => {
    fc.assert(
      fc.property(
        safeStr(1, 30),
        safeStr(1, 10),
        safeStr(1, 50),
        (name, version, description) => {
          const mgr = makeManager();
          const content = makeDoc(name, version, description);
          const result = mgr.validateMetadata(content);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('缺少 name 时验证失败', () => {
    const mgr = makeManager();
    const result = mgr.validateMetadata('---\nversion: 1.0.0\ndescription: test\n---\n');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('缺少 version 时验证失败', () => {
    const mgr = makeManager();
    const result = mgr.validateMetadata('---\nname: test\ndescription: test\n---\n');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  it('缺少 description 时验证失败', () => {
    const mgr = makeManager();
    const result = mgr.validateMetadata('---\nname: test\nversion: 1.0.0\n---\n');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('description'))).toBe(true);
  });
});

// =============================================================================
// Property 17: Skill 文档 CRUD 往返
// =============================================================================

describe('Property 17: Skill 文档 CRUD 往返', () => {
  it('上传后 getDocument 返回一致内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        safeStr(1, 10),
        async (name, version) => {
          const mgr = makeManager();
          const content = makeDoc(name, version, 'test description', 'body content');
          const doc = await mgr.uploadDocument(content);
          const fetched = await mgr.getDocument(doc.id);
          expect(fetched.metadata.name).toBe(name);
          expect(fetched.metadata.version).toBe(version);
          expect(fetched.markdownContent).toBe(content);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('删除后 getDocument 抛出错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        async (name) => {
          const mgr = makeManager();
          const content = makeDoc(name, '1.0.0', 'desc');
          const doc = await mgr.uploadDocument(content);
          await mgr.deleteDocument(doc.id);
          await expect(mgr.getDocument(doc.id)).rejects.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('listDocuments 返回所有上传的文档摘要', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          safeStr(1, 15),
          { minLength: 1, maxLength: 5 },
        ),
        async (names) => {
          const mgr = makeManager();
          const uniqueNames = [...new Set(names)];
          for (const name of uniqueNames) {
            await mgr.uploadDocument(makeDoc(name, '1.0.0', 'desc'));
          }
          const list = await mgr.listDocuments();
          expect(list.length).toBe(uniqueNames.length);
        },
      ),
      { numRuns: 30 },
    );
  });
});

// =============================================================================
// Property 18: Skill 文档版本回滚往返
// =============================================================================

describe('Property 18: Skill 文档版本回滚往返', () => {
  it('回滚后内容与历史版本一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        async (name) => {
          const mgr = makeManager();
          const v1Content = makeDoc(name, '1.0.0', 'version one');
          const doc = await mgr.uploadDocument(v1Content);

          const v2Content = makeDoc(name, '2.0.0', 'version two');
          await mgr.updateDocument(doc.id, v2Content);

          // Rollback to v1
          const rolled = await mgr.rollbackToVersion(doc.id, '1.0.0');
          expect(rolled.markdownContent).toBe(v1Content);
          expect(rolled.metadata.version).toBe('1.0.0');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('getVersionHistory 包含所有历史版本', async () => {
    const mgr = makeManager();
    const doc = await mgr.uploadDocument(makeDoc('test', '1.0.0', 'desc'));
    await mgr.updateDocument(doc.id, makeDoc('test', '2.0.0', 'desc v2'));
    await mgr.updateDocument(doc.id, makeDoc('test', '3.0.0', 'desc v3'));

    const history = await mgr.getVersionHistory(doc.id);
    const versions = history.map(h => h.version);
    expect(versions).toContain('1.0.0');
    expect(versions).toContain('2.0.0');
    expect(versions).toContain('3.0.0');
  });
});
