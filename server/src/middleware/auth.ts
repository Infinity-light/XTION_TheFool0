// =============================================================================
// XTION_TheFool0 — API 认证中间件
// Requirements: 8.2
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import { authManager } from '../modules/auth-manager';

// Extend Express Request to carry contestantId after auth
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      contestantId?: string;
    }
  }
}

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Validates Bearer token from Authorization header.
 * Sets req.contestantId on success.
 * Requirements: 8.2
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(httpError(401, 'AUTH_MISSING_KEY', '缺少 Authorization: Bearer <key> 头'));
  }

  const key = authHeader.slice(7).trim();
  if (!key) {
    return next(httpError(401, 'AUTH_MISSING_KEY', '缺少 Authorization: Bearer <key> 头'));
  }

  try {
    const result = await authManager.validateKey(key);
    if (!result.valid || !result.contestantId) {
      return next(httpError(401, 'AUTH_INVALID_KEY', 'Key 无效或已被吊销'));
    }
    // Use contestantId (contestants.id) for downstream handlers
    req.contestantId = result.contestantId;
    next();
  } catch (err) {
    next(err);
  }
}
