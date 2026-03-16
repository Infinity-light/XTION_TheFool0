// =============================================================================
// XTION_TheFool0 — DocDistributor 模块
// Requirements: 7.7, 7.8, 7.10, 9.2, 12.1, 12.2, 12.3, 12.5
// =============================================================================

import type { Database as DatabaseType } from 'better-sqlite3';
import { db as globalDb } from '../db';
import { connections, sendEvent } from '../ws';
import { skillDocManager, SkillDocManagerClass } from './skill-doc-manager';
import type {
  IDocDistributor,
  SkillMetadata,
  PlatformDocument,
  ServerEvent,
} from '../types';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface PlatformDocRow {
  id: string;
  name: string;
  markdown_content: string;
  is_mandatory: number;
  updated_at: number;
}

function rowToDoc(row: PlatformDocRow): PlatformDocument {
  return {
    id: row.id,
    name: row.name,
    markdownContent: row.markdown_content,
    isMandatory: row.is_mandatory === 1,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// DocDistributorClass — injectable for testing
// ---------------------------------------------------------------------------

export class DocDistributorClass implements IDocDistributor {
  private db: DatabaseType;
  private skillMgr: SkillDocManagerClass;
  private connectionsMap: Map<string, WebSocket>;
  private sendEventFn: (ws: WebSocket, event: ServerEvent) => void;

  constructor(
    db: DatabaseType,
    skillMgr?: SkillDocManagerClass,
    connectionsMap?: Map<string, WebSocket>,
    sendEventFn?: (ws: WebSocket, event: ServerEvent) => void,
  ) {
    this.db = db;
    this.skillMgr = skillMgr ?? new SkillDocManagerClass(db);
    this.connectionsMap = connectionsMap ?? new Map();
    this.sendEventFn = sendEventFn ?? sendEvent;
  }

  /**
   * List available skills — returns metadata summaries only (no full body)
   * Requirements: 7.7
   */
  async listAvailableSkills(_contestantId: string): Promise<SkillMetadata[]> {
    return this.skillMgr.listDocuments();
  }

  /**
   * Install a skill — returns full Markdown content
   * Requirements: 7.8
   */
  async installSkill(contestantId: string, skillDocId: string): Promise<string> {
    const doc = await this.skillMgr.getDocument(skillDocId);

    // Track installed skill on contestant
    const row = this.db.prepare('SELECT installed_skills FROM contestants WHERE id = ?').get(contestantId) as
      | { installed_skills: string }
      | undefined;

    if (row) {
      const installed: string[] = JSON.parse(row.installed_skills) as string[];
      if (!installed.includes(skillDocId)) {
        installed.push(skillDocId);
        this.db.prepare('UPDATE contestants SET installed_skills = ? WHERE id = ?').run(
          JSON.stringify(installed),
          contestantId,
        );
      }
    }

    return doc.markdownContent;
  }

  /**
   * Get all mandatory platform documents
   * Requirements: 12.1, 12.2
   */
  async getMandatoryDocuments(): Promise<PlatformDocument[]> {
    const rows = this.db.prepare(
      "SELECT * FROM platform_documents WHERE is_mandatory = 1 ORDER BY name",
    ).all() as PlatformDocRow[];
    return rows.map(rowToDoc);
  }

  /**
   * Get a specific platform document by name
   * Requirements: 12.4
   */
  async getPlatformDocument(docName: string): Promise<PlatformDocument> {
    const row = this.db.prepare('SELECT * FROM platform_documents WHERE name = ?').get(docName) as
      | PlatformDocRow
      | undefined;
    if (!row) {
      throw Object.assign(new Error(`平台文档不存在: ${docName}`), {
        code: 'DOC_NOT_FOUND',
        statusCode: 404,
      });
    }
    return rowToDoc(row);
  }

  /**
   * Notify all online contestants of a document update
   * Requirements: 12.5
   */
  async notifyDocumentUpdate(docName: string): Promise<void> {
    const timestamp = Date.now();
    const event: ServerEvent = {
      type: 'doc.update',
      payload: { docName, timestamp },
      timestamp,
    };

    for (const ws of this.connectionsMap.values()) {
      this.sendEventFn(ws, event);
    }
  }

  /**
   * Push mandatory documents to a newly connected contestant
   * Requirements: 9.2, 12.3
   */
  async pushMandatoryDocuments(contestantId: string): Promise<void> {
    const docs = await this.getMandatoryDocuments();
    const ws = this.connectionsMap.get(contestantId);
    if (!ws) return;

    const timestamp = Date.now();
    for (const doc of docs) {
      this.sendEventFn(ws, {
        type: 'doc.mandatory',
        payload: { docName: doc.name, content: doc.markdownContent },
        timestamp,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — uses global db and ws connections
// ---------------------------------------------------------------------------

class DocDistributorSingleton extends DocDistributorClass {
  constructor() {
    super(globalDb, skillDocManager as unknown as SkillDocManagerClass, connections, sendEvent);
  }
}

export const docDistributor = new DocDistributorSingleton();
