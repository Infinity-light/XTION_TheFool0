// =============================================================================
// XTION_TheFool0 — 平台文档属性测试
// Property 34: 平台文档更新通知
// Property 35: 平台文档查询往返
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { SkillDocManagerClass } from '../../modules/skill-doc-manager';
import { DocDistributorClass } from '../../modules/doc-distributor';
import type { ServerEvent } from '../../types';

// ---------------------------------------------------------------------------
// In-memory DB factory
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
    CREATE TABLE platform_documents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      markdown_content TEXT NOT NULL DEFAULT '',
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
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
  return db;
}

type TestDb = ReturnType<typeof makeDb>;

function makeDistributor(db: TestDb) {
  const skillMgr = new SkillDocManagerClass(db);
  const conns = new Map<string, WebSocket>();
  const sent: Array<{ contestantId: string; event: ServerEvent }> = [];

  const sendFn = (ws: WebSocket, event: ServerEvent) => {
    for (const [id, w] of conns) {
      if (w === ws) {
        sent.push({ contestantId: id, event });
        break;
      }
    }
  };

  const dist = new DocDistributorClass(db, skillMgr, conns, sendFn);
  return { dist, conns, sent };
}

function makeMockWs(): WebSocket {
  return {} as WebSocket;
}

const safeStr = (min = 1, max = 20) =>
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')),
    { minLength: min, maxLength: max },
  );

// ---------------------------------------------------------------------------
// Property 34: 平台文档更新通知
// ---------------------------------------------------------------------------

describe('Property 34: 平台文档更新通知', () => {
  it('更新平台文档后所有在线 Contestant 收到 doc.update 通知', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        safeStr(1, 10),
        async (numContestants, docName) => {
          const db = makeDb();
          const { dist, conns, sent } = makeDistributor(db);

          // Insert a platform document
          db.prepare(
            'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, 0, ?)',
          ).run(`doc-${docName}`, `${docName}.md`, '# original', Date.now());

          // Connect multiple contestants
          const contestantIds: string[] = [];
          for (let i = 0; i < numContestants; i++) {
            const id = `contestant-${i}`;
            contestantIds.push(id);
            conns.set(id, makeMockWs());
          }

          await dist.notifyDocumentUpdate(`${docName}.md`);

          // Every connected contestant should receive a doc.update event
          const updateEvents = sent.filter(s => s.event.type === 'doc.update');
          expect(updateEvents.length).toBe(numContestants);

          const notifiedIds = updateEvents.map(e => e.contestantId);
          for (const id of contestantIds) {
            expect(notifiedIds).toContain(id);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('doc.update 事件包含正确的文档名称', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 15),
        async (docName) => {
          const db = makeDb();
          const { dist, conns, sent } = makeDistributor(db);

          const fullDocName = `${docName}.md`;
          db.prepare(
            'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, 0, ?)',
          ).run(`doc-${docName}`, fullDocName, '# content', Date.now());

          conns.set('c1', makeMockWs());
          await dist.notifyDocumentUpdate(fullDocName);

          const event = sent.find(s => s.event.type === 'doc.update');
          expect(event).toBeDefined();
          expect((event!.event.payload as { docName: string }).docName).toBe(fullDocName);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('无在线 Contestant 时通知不报错', async () => {
    const db = makeDb();
    const { dist } = makeDistributor(db);

    // No connections registered
    await expect(dist.notifyDocumentUpdate('RULES.md')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Property 35: 平台文档查询往返
// ---------------------------------------------------------------------------

describe('Property 35: 平台文档查询往返', () => {
  it('查询返回最新版本内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 15),
        fc.string({ minLength: 5, maxLength: 100 }),
        async (docName, content) => {
          const db = makeDb();
          const { dist } = makeDistributor(db);

          const fullDocName = `${docName}.md`;
          db.prepare(
            'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, 0, ?)',
          ).run(`doc-${docName}`, fullDocName, content, Date.now());

          const doc = await dist.getPlatformDocument(fullDocName);
          expect(doc.name).toBe(fullDocName);
          expect(doc.markdownContent).toBe(content);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('更新后查询返回新内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 15),
        fc.string({ minLength: 5, maxLength: 100 }),
        fc.string({ minLength: 5, maxLength: 100 }),
        async (docName, originalContent, updatedContent) => {
          const db = makeDb();
          const { dist } = makeDistributor(db);

          const fullDocName = `${docName}.md`;
          db.prepare(
            'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, 0, ?)',
          ).run(`doc-${docName}`, fullDocName, originalContent, Date.now());

          // Update content
          db.prepare(
            'UPDATE platform_documents SET markdown_content = ?, updated_at = ? WHERE name = ?',
          ).run(updatedContent, Date.now(), fullDocName);

          const doc = await dist.getPlatformDocument(fullDocName);
          expect(doc.markdownContent).toBe(updatedContent);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('查询不存在的文档抛出 DOC_NOT_FOUND 错误', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 15),
        async (docName) => {
          const db = makeDb();
          const { dist } = makeDistributor(db);

          await expect(dist.getPlatformDocument(`nonexistent-${docName}.md`)).rejects.toMatchObject({
            code: 'DOC_NOT_FOUND',
          });
        },
      ),
      { numRuns: 30 },
    );
  });
});
