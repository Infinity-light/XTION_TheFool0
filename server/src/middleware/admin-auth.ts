// =============================================================================
// XTION_TheFool0 — 管理员认证中间件
// =============================================================================

import type { Request, Response, NextFunction } from 'express';

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function getConfiguredAdminToken(): string {
  return process.env.OPENCLAW_ADMIN_TOKEN?.trim() ?? '';
}

export function adminAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const configuredToken = getConfiguredAdminToken();
  if (!configuredToken) {
    next(httpError(503, 'ADMIN_AUTH_NOT_CONFIGURED', '服务器未配置 OPENCLAW_ADMIN_TOKEN'));
    return;
  }

  const providedToken = req.headers['x-admin-token'];
  const token =
    typeof providedToken === 'string'
      ? providedToken.trim()
      : Array.isArray(providedToken)
        ? providedToken[0]?.trim() ?? ''
        : '';

  if (!token) {
    next(httpError(401, 'ADMIN_AUTH_REQUIRED', '缺少 X-Admin-Token 管理员令牌'));
    return;
  }

  if (token !== configuredToken) {
    next(httpError(403, 'ADMIN_AUTH_INVALID', '管理员令牌无效'));
    return;
  }

  next();
}
