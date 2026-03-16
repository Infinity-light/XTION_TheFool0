// =============================================================================
// XTION_TheFool0 — 管理员批量移动路由
// Requirements: 5.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { worldManager } from '../modules/world-manager';
import { connections, sendEvent } from '../ws';

export const adminMoveRouter = Router();

// ---------------------------------------------------------------------------
// 辅助函数：创建带 statusCode 和 code 属性的 HTTP 错误
// ---------------------------------------------------------------------------

function createHttpError(
  statusCode: number,
  code: string,
  message: string,
): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// POST /api/admin/move/batch — 批量移动 Contestant 到指定 Zone 中心
// Requirements: 5.6
// ---------------------------------------------------------------------------

adminMoveRouter.post('/move/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contestantIds, zoneId } = req.body as {
      contestantIds?: unknown;
      zoneId?: unknown;
    };

    // Validate contestantIds
    if (!Array.isArray(contestantIds) || contestantIds.length === 0) {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 contestantIds 必须为非空数组'));
    }
    if (contestantIds.some((id) => typeof id !== 'string')) {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 contestantIds 中每个元素必须为字符串'));
    }

    // Validate zoneId
    if (!zoneId || typeof zoneId !== 'string') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 zoneId 不能为空'));
    }

    // Resolve zone
    const zone = worldManager.getZoneById(zoneId);
    if (!zone) {
      return next(createHttpError(404, 'WORLD_ZONE_NOT_FOUND', `Zone 不存在: ${zoneId}`));
    }

    const newPosition = worldManager.getZoneCenter(zone);
    const timestamp = Date.now();

    // Move each contestant
    await Promise.all(
      (contestantIds as string[]).map(async (id) => {
        await worldManager.setPosition(id, newPosition);

        // Push contestant.move WebSocket event if connected
        const ws = connections.get(id);
        if (ws) {
          sendEvent(ws, {
            type: 'contestant.move',
            payload: { id, position: newPosition, zoneId },
            timestamp,
          });
        }
      }),
    );

    res.json({
      moved: contestantIds.length,
      zoneId,
      newPosition,
      timestamp,
    });
  } catch (err) {
    next(err);
  }
});
