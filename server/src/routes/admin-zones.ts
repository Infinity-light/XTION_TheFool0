// =============================================================================
// XTION_TheFool0 — 管理员 Zone 管理路由
// Requirements: 2.3, 2.5, 11.3
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { worldManager } from '../modules/world-manager';
import { db } from '../db';
import type { ZoneRule } from '../types';

export const adminZonesRouter = Router();

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

// =============================================================================
// Zone 路由
// =============================================================================

// ---------------------------------------------------------------------------
// GET /api/admin/zones — 获取所有 Zone
// Requirements: 2.3
// ---------------------------------------------------------------------------

adminZonesRouter.get('/zones', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const zones = worldManager.getAllZones();
    res.json(zones);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/zones/:id — 获取单个 Zone
// Requirements: 2.3
// ---------------------------------------------------------------------------

adminZonesRouter.get('/zones/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const zone = worldManager.getZoneById(req.params['id'] as string);
    if (!zone) {
      return next(createHttpError(404, 'WORLD_ZONE_NOT_FOUND', `Zone 不存在: ${req.params['id']}`));
    }
    res.json(zone);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/zones — 创建 Zone
// Requirements: 2.3
// ---------------------------------------------------------------------------

adminZonesRouter.post('/zones', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, bounds, zoneTypeId, style, accessRestriction } = req.body as {
      name?: string;
      bounds?: { x1: number; y1: number; x2: number; y2: number };
      zoneTypeId?: string;
      style?: { fillColor: string; borderColor: string; opacity: number; icon?: string };
      accessRestriction?: string[];
    };

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 name 不能为空'));
    }
    if (!bounds || typeof bounds.x1 !== 'number' || typeof bounds.y1 !== 'number' ||
        typeof bounds.x2 !== 'number' || typeof bounds.y2 !== 'number') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 bounds 格式不正确，需包含 x1, y1, x2, y2'));
    }
    if (!zoneTypeId || typeof zoneTypeId !== 'string') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 zoneTypeId 不能为空'));
    }
    if (!style || typeof style.fillColor !== 'string' || typeof style.borderColor !== 'string' ||
        typeof style.opacity !== 'number') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 style 格式不正确，需包含 fillColor, borderColor, opacity'));
    }

    const zone = await worldManager.createZone({
      name: name.trim(),
      bounds,
      zoneTypeId,
      style,
      ...(accessRestriction ? { accessRestriction } : {}),
    });

    res.status(201).json(zone);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/zones/:id — 编辑 Zone
// Requirements: 2.3
// ---------------------------------------------------------------------------

adminZonesRouter.put('/zones/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const zoneId = req.params['id'] as string;
    const { name, bounds, zoneTypeId, style, accessRestriction } = req.body as {
      name?: string;
      bounds?: { x1: number; y1: number; x2: number; y2: number };
      zoneTypeId?: string;
      style?: { fillColor: string; borderColor: string; opacity: number; icon?: string };
      accessRestriction?: string[];
    };

    const zone = await worldManager.updateZone(zoneId, {
      ...(name !== undefined ? { name } : {}),
      ...(bounds !== undefined ? { bounds } : {}),
      ...(zoneTypeId !== undefined ? { zoneTypeId } : {}),
      ...(style !== undefined ? { style } : {}),
      ...(accessRestriction !== undefined ? { accessRestriction } : {}),
    });

    res.json(zone);
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not found')) {
      return next(createHttpError(404, 'WORLD_ZONE_NOT_FOUND', e.message));
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/zones/:id — 删除 Zone
// Requirements: 2.3
// ---------------------------------------------------------------------------

adminZonesRouter.delete('/zones/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await worldManager.deleteZone(req.params['id'] as string);
    res.status(204).end();
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not found')) {
      return next(createHttpError(404, 'WORLD_ZONE_NOT_FOUND', e.message));
    }
    next(err);
  }
});

// =============================================================================
// Zone_Type 路由
// =============================================================================

// ---------------------------------------------------------------------------
// GET /api/admin/zone-types — 获取所有 Zone_Type
// Requirements: 2.5
// ---------------------------------------------------------------------------

adminZonesRouter.get('/zone-types', (_req: Request, res: Response, next: NextFunction) => {
  try {
    interface ZoneTypeRow {
      id: string;
      name: string;
      description: string;
      is_builtin: number;
    }
    interface ZoneRuleRow {
      allowed_apis: string;
      forbidden_apis: string;
      rate_limits: string;
      attribute_effects: string;
      custom_params: string;
    }

    const rows = db.prepare('SELECT * FROM zone_types').all() as ZoneTypeRow[];
    const zoneTypes = rows.map((row) => {
      const ruleRow = db.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get(row.id) as ZoneRuleRow | undefined;
      const rule: ZoneRule = ruleRow
        ? {
            allowedAPIs: JSON.parse(ruleRow.allowed_apis) as string[],
            forbiddenAPIs: JSON.parse(ruleRow.forbidden_apis) as string[],
            rateLimits: JSON.parse(ruleRow.rate_limits) as Record<string, number>,
            attributeEffects: JSON.parse(ruleRow.attribute_effects) as [],
            customParams: JSON.parse(ruleRow.custom_params) as Record<string, unknown>,
          }
        : { allowedAPIs: ['*'], forbiddenAPIs: [], rateLimits: {}, attributeEffects: [], customParams: {} };

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        isBuiltin: row.is_builtin === 1,
        rule,
      };
    });

    res.json(zoneTypes);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/zone-types — 创建自定义 Zone_Type
// Requirements: 2.5
// ---------------------------------------------------------------------------

adminZonesRouter.post('/zone-types', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, rule } = req.body as {
      name?: string;
      description?: string;
      rule?: ZoneRule;
    };

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 name 不能为空'));
    }
    if (!rule || !Array.isArray(rule.allowedAPIs) || !Array.isArray(rule.forbiddenAPIs)) {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 rule 格式不正确，需包含 allowedAPIs, forbiddenAPIs'));
    }

    const zoneType = await worldManager.createZoneType({
      name: name.trim(),
      description: description ?? '',
      isBuiltin: false,
      rule: {
        allowedAPIs: rule.allowedAPIs,
        forbiddenAPIs: rule.forbiddenAPIs,
        rateLimits: rule.rateLimits ?? {},
        attributeEffects: rule.attributeEffects ?? [],
        customParams: rule.customParams ?? {},
      },
    });

    res.status(201).json(zoneType);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/zone-types/:id/rules — 编辑 Zone_Rule
// Requirements: 11.3
// ---------------------------------------------------------------------------

adminZonesRouter.put('/zone-types/:id/rules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const zoneTypeId = req.params['id'] as string;
    const rule = req.body as ZoneRule;

    if (!rule || !Array.isArray(rule.allowedAPIs) || !Array.isArray(rule.forbiddenAPIs)) {
      return next(createHttpError(400, 'INVALID_PARAM', '请求体需为合法的 ZoneRule 对象，包含 allowedAPIs, forbiddenAPIs'));
    }

    await worldManager.updateZoneRule(zoneTypeId, {
      allowedAPIs: rule.allowedAPIs,
      forbiddenAPIs: rule.forbiddenAPIs,
      rateLimits: rule.rateLimits ?? {},
      attributeEffects: rule.attributeEffects ?? [],
      customParams: rule.customParams ?? {},
    });

    res.status(204).end();
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not found')) {
      return next(createHttpError(404, 'WORLD_ZONE_TYPE_NOT_FOUND', e.message));
    }
    next(err);
  }
});
