// =============================================================================
// XTION_TheFool0 — DocDistributor 属性测试
// Property 19: Skill 文档分发正确性
// Property 23: 必装文档自动下发
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

function makeDistributor(db: ReturnType<typeof makeDb>) {
  const skillMgr = new SkillDocManagerClass(db);
  const conns = new Map<string, WebSocket>();
  const sent: Array<{ contestantId: string; event: ServerEvent }> = [];

  const sendFn = (ws: WebSocket, event: ServerEvent) => {
    // Find contestantId by ws reference
    for (const [id, w] of conns) {
      if (w === ws) {
        sent.push({ contestantId: id, event });
        break;
      }
    }
  };

  const dist = new DocDistributorClass(db, skillMgr, conns, sendFn);
  return { dist, skillMgr, conns, sent };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const safeStr = (min = 1, max = 20) =>
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')),
    { minLength: min, maxLength: max },
  );

function makeDoc(name: string, version: string, description: string, body = 'body') {
  return `---\nname: ${name}\nversion: ${version}\ndescription: ${description}\n---\n\n${body}`;
}

// Minimal mock WebSocket
function makeMockWs(): WebSocket {
  return {} as WebSocket;
}

// ---------------------------------------------------------------------------
// Property 19: Skill 文档分发正确性
// ---------------------------------------------------------------------------

describe('Property 19: Skill 文档分发正确性', () => {
  it('listAvailableSkills 返回 Metadata 摘要（不含完整正文）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(safeStr(1, 15), { minLength: 1, maxLength: 5 }),
        async (names) => {
          const db = makeDb();
          const { dist, skillMgr } = makeDistributor(db);
          const uniqueNames = [...new Set(names)];

          for (const name of uniqueNames) {
            await skillMgr.uploadDocument(makeDoc(name, '1.0.0', 'desc', 'full body content here'));
          }

          const list = await dist.listAvailableSkills('any-contestant');

          // Should return same count
          expect(list.length).toBe(uniqueNames.length);

          // Each item should have metadata fields
          for (const meta of list) {
            expect(typeof meta.name).toBe('string');
            expect(typeof meta.version).toBe('string');
            expect(typeof meta.description).toBe('string');
            // Metadata should NOT have markdownContent (it's SkillMetadata, not SkillDocument)
            expect((meta as unknown as Record<string, unknown>).markdownContent).toBeUndefined();
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('installSkill 返回完整 Markdown 内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        fc.string({ minLength: 10, maxLength: 200 }),
        async (name, bodyContent) => {
          const db = makeDb();
          const { dist, skillMgr } = makeDistributor(db);

          const fullContent = makeDoc(name, '1.0.0', 'desc', bodyContent);
          const doc = await skillMgr.uploadDocument(fullContent);

          const installed = await dist.installSkill('contestant-1', doc.id);

          // Should return the full markdown content
          expect(installed).toBe(fullContent);
          expect(installed.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('installSkill 内容比 listAvailableSkills 摘要更完整', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        async (name) => {
          const db = makeDb();
          const { dist, skillMgr } = makeDistributor(db);

          const fullContent = makeDoc(name, '1.0.0', 'desc', 'This is the full body content that should only appear on install');
          const doc = await skillMgr.uploadDocument(fullContent);

          const list = await dist.listAvailableSkills('c1');
          const installed = await dist.installSkill('c1', doc.id);

          // List returns metadata only — no markdownContent field
          const meta = list.find(m => m.name === name);
          expect(meta).toBeDefined();
          expect((meta as unknown as Record<string, unknown>).markdownContent).toBeUndefined();

          // Install returns full content
          expect(installed).toContain('full body content');
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 23: 必装文档自动下发
// ---------------------------------------------------------------------------

describe('Property 23: 必装文档自动下发', () => {
  it('接入后自动下发所有必装文档', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(safeStr(1, 10), { minLength: 1, maxLength: 4 }),
        async (docNames) => {
          const db = makeDb();
          const { dist, conns, sent } = makeDistributor(db);

          const uniqueNames = [...new Set(docNames)].map(n => `${n}.md`);
          const now = Date.now();

          // Insert mandatory platform documents
          for (const name of uniqueNames) {
            db.prepare(
              'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, 1, ?)',
            ).run(`doc-${name}`, name, `# ${name}\ncontent`, now);
          }

          // Simulate contestant connection
          const contestantId = 'contestant-test-1';
          const mockWs = makeMockWs();
          conns.set(contestantId, mockWs);

          await dist.pushMandatoryDocuments(contestantId);

          // Should have sent one event per mandatory doc
          const docEvents = sent.filter(s => s.contestantId === contestantId && s.event.type === 'doc.mandatory');
          expect(docEvents.length).toBe(uniqueNames.length);

          // Each event should contain the doc name and content
          const sentDocNames = docEvents.map(e => (e.event.payload as { docName: string }).docName);
          for (const name of uniqueNames) {
            expect(sentDocNames).toContain(name);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('非必装文档不会被自动下发', async () => {
    const db = makeDb();
    const { dist, conns, sent } = makeDistributor(db);
    const now = Date.now();

    // Insert one mandatory and one non-mandatory doc
    db.prepare(
      'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('doc-mandatory', 'MANDATORY.md', '# mandatory', 1, now);
    db.prepare(
      'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('doc-optional', 'OPTIONAL.md', '# optional', 0, now);

    const contestantId = 'contestant-2';
    const mockWs = makeMockWs();
    conns.set(contestantId, mockWs);

    await dist.pushMandatoryDocuments(contestantId);

    const docEvents = sent.filter(s => s.contestantId === contestantId && s.event.type === 'doc.mandatory');
    expect(docEvents.length).toBe(1);
    expect((docEvents[0].event.payload as { docName: string }).docName).toBe('MANDATORY.md');
  });

  it('未连接的 Contestant 不会收到文档推送', async () => {
    const db = makeDb();
    const { dist, sent } = makeDistributor(db);
    const now = Date.now();

    db.prepare(
      'INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at) VALUES (?, ?, ?, 1, ?)',
    ).run('doc-hb', 'HEARTBEAT.md', '# heartbeat', now);

    // Do NOT add contestant to connections map
    await dist.pushMandatoryDocuments('not-connected-contestant');

    expect(sent.length).toBe(0);
  });
});
