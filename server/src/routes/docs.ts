// =============================================================================
// XTION_TheFool0 — 平台文档 API
// Requirements: 12.4, 12.5, 12.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { docDistributor } from '../modules/doc-distributor';

export const docsRouter = Router();

const OPENAPI_SUMMARY = {
  openapi: '3.0.0',
  info: { title: 'XTION_TheFool0 OpenClaw API', version: '1.0.0' },
  paths: {
    '/api/talk': { post: { summary: '向同 Zone 内的 Contestant 发送消息', tags: ['Agent'] } },
    '/api/broadcast': { post: { summary: '向所有在线 Contestant 广播消息', tags: ['Agent'] } },
    '/api/move': { post: { summary: '移动到指定坐标或 Zone', tags: ['Agent'] } },
    '/api/heartbeat': { post: { summary: '发送心跳', tags: ['Agent'] } },
    '/api/skills': { get: { summary: '获取可用 Skill 列表', tags: ['Agent'] } },
    '/api/skills/{id}/install': { get: { summary: '安装 Skill', tags: ['Agent'] } },
    '/api/status/me': { get: { summary: '查询自身状态', tags: ['Agent'] } },
    '/api/status/{id}': { get: { summary: '查询其他 Contestant 公开状态', tags: ['Agent'] } },
    '/api/contestants': { get: { summary: '获取在线 Contestant 列表', tags: ['Agent'] } },
    '/api/zones': { get: { summary: '获取所有 Zone 信息', tags: ['Agent'] } },
    '/api/zones/{id}': { get: { summary: '获取 Zone 详情', tags: ['Agent'] } },
    '/api/world': { get: { summary: '获取 World 概览', tags: ['Agent'] } },
    '/api/messages': { get: { summary: '获取消息历史', tags: ['Agent'] } },
    '/api/events': { get: { summary: '查询事件历史', tags: ['Agent'] } },
    '/api/barrage': { post: { summary: '发送弹幕', tags: ['Audience'] } },
    '/api/contestants/{id}/vote': { post: { summary: '点赞/踩', tags: ['Audience'] } },
    '/api/audience-feedback': { get: { summary: '观众互动数据汇总', tags: ['Audience'] } },
    '/api/admin/keys': {
      post: { summary: '生成 Key', tags: ['Admin'] },
      get: { summary: '获取 Key 列表', tags: ['Admin'] },
    },
    '/api/admin/monitor': { get: { summary: '平台运行状态概览', tags: ['Admin'] } },
  },
};

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// GET /api/docs — OpenAPI summary
// Requirements: 8.12
// ---------------------------------------------------------------------------

docsRouter.get('/', (_req: Request, res: Response) => {
  res.json(OPENAPI_SUMMARY);
});

// ---------------------------------------------------------------------------
// GET /api/docs/:doc_name — 获取平台文档
// Requirements: 12.4, 12.6
// ---------------------------------------------------------------------------

docsRouter.get('/:doc_name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await docDistributor.getPlatformDocument(req.params['doc_name'] as string);
    res.json(doc);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND') return next(httpError(404, 'DOC_NOT_FOUND', e.message));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/docs/:doc_name — 管理员编辑平台文档
// Requirements: 12.5, 12.6
// ---------------------------------------------------------------------------

export const adminDocsRouter = Router();

adminDocsRouter.put('/:doc_name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, markdownContent } = req.body as { content?: string; markdownContent?: string };
    const resolvedContent = content ?? markdownContent;
    if (!resolvedContent || typeof resolvedContent !== 'string') {
      return next(httpError(400, 'INVALID_PARAM', '参数 content 不能为空'));
    }

    const docName = req.params['doc_name'] as string;

    // Check doc exists
    const existing = db.prepare('SELECT id FROM platform_documents WHERE name = ?').get(docName) as
      | { id: string }
      | undefined;
    if (!existing) {
      return next(httpError(404, 'DOC_NOT_FOUND', `平台文档不存在: ${docName}`));
    }

    db.prepare(
      'UPDATE platform_documents SET markdown_content = ?, updated_at = ? WHERE name = ?',
    ).run(resolvedContent, Date.now(), docName);

    // Notify all online contestants of the update
    await docDistributor.notifyDocumentUpdate(docName);

    const updated = await docDistributor.getPlatformDocument(docName);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
