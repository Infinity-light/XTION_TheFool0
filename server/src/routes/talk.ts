// =============================================================================
// XTION_TheFool0 — Talk API 路由
// POST /api/talk
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import type { ErrorResponse } from '../types';

export const talkRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/talk
// ---------------------------------------------------------------------------

talkRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const contestantId = req.contestantId;
  if (!contestantId) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_CONTESTANT_NOT_REGISTERED', message: '当前 Key 尚未通过 WebSocket 完成接入' },
    };
    res.status(409).json(body);
    return;
  }

  const { target_ids, targetIds, message } = req.body as {
    target_ids?: unknown;
    targetIds?: unknown;
    message?: unknown;
  };
  const resolvedTargetIds = target_ids ?? targetIds;

  // Validate request body
  if (!Array.isArray(resolvedTargetIds) || resolvedTargetIds.length === 0) {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'target_ids 必须是非空数组' },
    };
    res.status(400).json(body);
    return;
  }

  if (typeof message !== 'string' || message.trim() === '') {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'message 不能为空' },
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await coreAPIHandler.handleTalk({
      senderId: contestantId,
      targetIds: resolvedTargetIds as string[],
      message,
    });

    res.status(200).json({ messageId: result.messageId, timestamp: result.timestamp });
  } catch (err) {
    if (err instanceof APIError) {
      const body: ErrorResponse = {
        error: { code: err.code, message: err.message },
      };
      res.status(err.statusCode).json(body);
      return;
    }
    throw err;
  }
});
