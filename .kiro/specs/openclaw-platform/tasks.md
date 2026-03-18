# Implementation Plan: XTION_TheFool0 — OpenClaw 多 Agent 交互平台

## Overview

基于 Node.js (TypeScript) + Express + ws + SQLite 后端，React + Phaser 3 前端的架构，按模块递增实现。每个任务构建在前一个任务之上，确保无孤立代码。所有代码示例使用 TypeScript。

## Tasks

- [x] 1. 项目初始化与基础架构搭建
  - [x] 1.1 初始化项目结构与依赖
    - 创建 monorepo 结构：`server/`（后端）和 `client/`（前端）
    - 后端：初始化 `package.json`，安装 `express`, `ws`, `better-sqlite3`, `gray-matter`, `marked`, `uuid`, `crypto` 等依赖
    - 前端：使用 Vite + React + TypeScript 初始化，安装 `phaser`, `zustand` 依赖
    - 配置 TypeScript `tsconfig.json`（后端和前端各一份）
    - _Requirements: 全局_

  - [x] 1.2 定义核心数据模型与 TypeScript 接口
    - 创建 `server/src/types/` 目录，定义所有数据模型接口：`Key`, `Contestant`, `Position`, `World`, `GameMap`, `Zone`, `ZoneBounds`, `ZoneStyle`, `ZoneType`, `ZoneRule`, `AttributeEffect`, `SkillDocument`, `SkillMetadata`, `DocumentVersion`, `PlatformDocument`, `HeartbeatPayload`, `HeartbeatRecord`, `HeartbeatConfig`, `HealthStatus`, `TalkMessage`, `BroadcastMessage`, `BarrageMessage`, `VoteRecord`, `ViewerInteractionSummary`, `PlatformEvent`, `EventType`, `ErrorResponse`
    - 定义 WebSocket 消息接口：`ClientMessage`, `ServerEvent`, `ServerResponse`
    - 定义核心模块接口：`IAuthManager`, `IWorldManager`, `ICoreAPIHandler`, `IHeartbeatMonitor`, `ISkillDocManager`, `IDocDistributor`, `IInteractionManager`, `IEventLogger`
    - _Requirements: 全局（设计文档数据模型章节）_

  - [x] 1.3 搭建 SQLite 数据库层
    - 创建 `server/src/db.ts`，初始化 SQLite 数据库连接
    - 创建数据表：`keys`, `contestants`, `zones`, `zone_types`, `zone_rules`, `skill_documents`, `document_versions`, `platform_documents`, `talk_messages`, `broadcast_messages`, `heartbeat_records`, `barrage_messages`, `vote_records`, `events`
    - 实现数据库初始化函数，插入内置 Zone_Type（Rest/Work/Social）及其默认 Zone_Rule
    - _Requirements: 2.4, 11.2_

  - [x] 1.4 搭建 Express HTTP 服务器与 WebSocket 服务器骨架
    - 创建 `server/src/app.ts`，配置 Express 应用（JSON body parser、CORS）
    - 创建 `server/src/ws.ts`，配置 ws WebSocket 服务器
    - 创建统一错误处理中间件，输出 `{ "error": { "code": "...", "message": "..." } }` 格式
    - 创建 `server/src/index.ts` 入口文件，启动 HTTP + WebSocket 服务
    - _Requirements: 8.1, 8.4, 8.10_

- [x] 2. Checkpoint — 基础架构验证
  - 确保项目可编译运行，HTTP 和 WebSocket 服务器可启动，数据库初始化成功。如有问题请向用户确认。

- [x] 3. AuthManager — Key 认证与 Agent 接入
  - [x] 3.1 实现 AuthManager 模块
    - 创建 `server/src/modules/auth-manager.ts`，实现 `IAuthManager` 接口
    - Key 生成：使用 `crypto.randomBytes` 生成 ≥32 字符的随机字符串
    - Key 验证：检查 Key 是否存在且状态为 active
    - Key 吊销与重新生成
    - Key 列表查询
    - 数据持久化到 SQLite `keys` 表
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.2 编写 AuthManager 属性测试
    - **Property 1: Key 唯一性与长度** — 批量生成 Key，验证长度 ≥32 且无重复
    - **Validates: Requirements 1.1**

  - [x] 3.3 编写认证正确性属性测试
    - **Property 2: 认证正确性** — 随机生成 valid/invalid/revoked Key，验证认证结果
    - **Validates: Requirements 1.3, 1.4**

  - [x] 3.4 实现 WebSocket 认证流程
    - 在 `server/src/ws.ts` 中实现 WebSocket 连接认证逻辑
    - 客户端发送 `auth` 消息携带 Key → 服务端调用 `AuthManager.validateKey` 验证
    - 认证成功：注册 Contestant，分配身份属性，设置初始 Position 为默认 Zone 中心，推送 `world.state` 事件
    - 认证失败：返回错误信息并关闭连接
    - 维护连接状态（在线/离线/忙碌/超时），断线 5 秒内标记离线并保留 Position
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 1.8_

  - [x] 3.5 编写选手初始放置属性测试
    - **Property 3: 选手初始放置** — 认证成功后 Contestant 的 Position 等于默认 Zone 中心坐标
    - **Validates: Requirements 1.5, 2.8**

  - [x] 3.6 编写断线状态属性测试
    - **Property 4: 断线状态与位置保留** — 断线后状态变为 offline，Position 不变
    - **Validates: Requirements 1.7**

  - [x] 3.7 实现管理员 Key 管理 API
    - 创建 `server/src/routes/admin-keys.ts`
    - POST `/api/admin/keys` — 生成新 Key
    - GET `/api/admin/keys` — 获取所有 Key 列表
    - DELETE `/api/admin/keys/:id` — 吊销 Key
    - POST `/api/admin/keys/:id/regenerate` — 重新生成 Key
    - _Requirements: 1.2_

- [x] 4. WorldManager — World 空间与 Map 系统
  - [x] 4.1 实现 WorldManager 核心逻辑
    - 创建 `server/src/modules/world-manager.ts`，实现 `IWorldManager` 接口
    - World/Map 初始化：创建 World 实例，设置 Map 尺寸和默认 Zone
    - Position 管理：setPosition / getPosition，内存缓存热数据
    - Zone 查询：getZoneAt（根据坐标查找所在 Zone）、getContestantsInZone
    - Zone_Rule 应用：getApplicableRules、isAPIAllowed
    - Energy 管理：getEnergy、modifyEnergy，根据 Zone_Type 规则计算变化
    - _Requirements: 2.1, 2.6, 2.7, 2.8, 11.4, 11.5, 11.6_

  - [x] 4.2 编写 Zone 位置查询属性测试
    - **Property 5: Zone 位置查询一致性** — 随机 Position 和 Zone 配置，验证查询结果
    - **Validates: Requirements 2.2, 2.7**

  - [x] 4.3 实现 Zone CRUD 与 Zone_Type 管理
    - Zone CRUD：createZone / updateZone / deleteZone，持久化到 SQLite
    - Zone_Type CRUD：createZoneType / updateZoneRule
    - 内置 Zone_Type 默认 Zone_Rule 配置（Rest: Talk 受频率限制 + Move，禁止工作类 API；Work: 全部允许；Social: Talk 无限制 + Broadcast + Move）
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 11.1, 11.2, 11.3_

  - [x] 4.3.1 编写 Zone 进入限制属性测试
    - **Property 13: Zone 进入限制** — 设置 accessRestriction 的 Zone，不在允许列表中的 Contestant 被拒绝
    - **Validates: Requirements 5.5**

  - [x] 4.4 实现管理员 Zone 管理 API
    - 创建 `server/src/routes/admin-zones.ts`
    - GET/POST/PUT/DELETE `/api/admin/zones` 和 `/api/admin/zones/:id`
    - GET/POST `/api/admin/zone-types` 和 PUT `/api/admin/zone-types/:id/rules`
    - _Requirements: 2.3, 2.5, 11.3_

  - [x] 4.5 编写 Energy 变化属性测试
    - **Property 31: Energy 变化遵循 Zone_Type 规则** — Rest 恢复、Work 消耗、Social 不变
    - **Validates: Requirements 11.4, 11.5, 11.6**

  - [x] 4.6 编写 Energy 耗尽限制属性测试
    - **Property 32: Energy 耗尽限制** — Energy 为 0 时仅 Move 可用
    - **Validates: Requirements 11.7**

  - [x] 4.7 编写 Zone_Rule 热更新属性测试
    - **Property 33: Zone_Rule 热更新** — 修改 Zone_Rule 后在线 Contestant 立即适用新规则
    - **Validates: Requirements 11.9**

- [x] 5. Checkpoint — 认证与世界系统验证
  - 确保 Key 生成/验证/吊销流程正常，WebSocket 认证成功后 Contestant 正确放置到默认 Zone，Zone CRUD 和 Zone_Type 管理正常。如有问题请向用户确认。

- [x] 6. RateLimiter — API 速率限制
  - [x] 6.1 实现 RateLimiter 模块
    - 创建 `server/src/modules/rate-limiter.ts`
    - 实现滑动窗口速率限制算法（内存计数器）
    - 全局 API 速率限制：默认每位 Contestant 每分钟 60 次
    - Broadcast 频率限制：可配置的每分钟最大广播次数
    - Zone_Rule 中的 Talk 频率限制
    - 超限时返回 HTTP 429 + `API_RATE_LIMITED` 错误
    - 创建 Express 中间件 `rateLimitMiddleware`
    - _Requirements: 3.8, 4.5, 8.11_

  - [x] 6.2 编写全局 API 速率限制属性测试
    - **Property 22: 全局 API 速率限制** — 超过 60 次/分钟后返回 429
    - **Validates: Requirements 8.11**

- [x] 7. CoreAPIHandler — Talk / Broadcast / Move
  - [x] 7.1 实现 Talk API
    - 创建 `server/src/modules/core-api-handler.ts`，实现 `ICoreAPIHandler` 接口
    - 实现 `handleTalk`：验证发送者和所有接收者在同一 Zone，跨 Zone 返回 403
    - 支持小组模式（多目标 targetIds）
    - 根据 Zone_Rule 应用频率限制（Social 无限制，Rest 受限）
    - 检查 Energy（为 0 时禁止 Talk）
    - 消息持久化到 SQLite `talk_messages` 表
    - 通过 WebSocket 推送 `talk.message` 事件给接收者
    - 创建 Express 路由 `POST /api/talk`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 7.2 编写 Talk Zone 约束属性测试
    - **Property 6: Talk Zone 约束** — 同 Zone 成功，跨 Zone 返回 403
    - **Validates: Requirements 3.1, 3.4, 3.5**

  - [x] 7.3 编写 Talk 频率限制属性测试
    - **Property 8: Talk 频率限制遵循 Zone 规则** — Social 无限制，Rest 受限
    - **Validates: Requirements 3.6, 3.7, 3.8**

  - [x] 7.4 实现 Broadcast API
    - 实现 `handleBroadcast`：向 World 中所有在线 Contestant 投递消息
    - 应用 Broadcast 频率限制
    - 消息持久化到 SQLite `broadcast_messages` 表
    - 通过 WebSocket 推送 `broadcast.message` 事件给所有在线 Contestant
    - 创建 Express 路由 `POST /api/broadcast`
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [x] 7.5 编写 Broadcast 全局投递属性测试
    - **Property 9: Broadcast 全局投递** — 所有在线 Contestant 都收到消息
    - **Validates: Requirements 4.1, 4.2**

  - [x] 7.6 编写 Broadcast 频率限制属性测试
    - **Property 10: Broadcast 频率限制** — 超过配置限制后被拒绝
    - **Validates: Requirements 4.5**

  - [x] 7.7 实现 Move API
    - 实现 `handleMove`：支持目标 Position 或 Zone ID（Zone 中心坐标）
    - 边界检查：目标超出 Map 范围返回 400
    - Zone 进入限制检查：accessRestriction 验证
    - 更新 Contestant Position，自动计算新 Zone
    - Zone 切换时应用新 Zone_Rule，通过 WebSocket 通知 `zone.rule.update`
    - 通过 WebSocket 通知原 Zone 和目标 Zone 中的 Contestant `contestant.move` 事件
    - Work 区 API 调用后扣减 Energy，推送 `energy.update`
    - 创建 Express 路由 `POST /api/move`
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 11.5_

  - [x] 7.8 编写 Move 更新位置属性测试
    - **Property 11: Move 更新位置** — 移动后 Position 等于目标坐标
    - **Validates: Requirements 5.1, 5.2**

  - [x] 7.9 编写 Move 边界检查属性测试
    - **Property 12: Move 边界检查** — 越界返回 400，Position 不变
    - **Validates: Requirements 5.4**

  - [x] 7.10 编写 Zone 切换规则属性测试
    - **Property 14: Zone 切换规则自动应用** — 移动后适用新 Zone 的 Zone_Rule
    - **Validates: Requirements 5.7**

  - [x] 7.11 实现管理员批量移动 API
    - 创建 Express 路由 `POST /api/admin/move/batch`
    - 将多个 Contestant 同时移动到指定 Zone 中心坐标
    - _Requirements: 5.6_

  - [x] 7.12 编写批量移动属性测试
    - **Property 15: 批量移动正确性** — 所有指定 Contestant 的 Position 更新为目标 Zone 中心
    - **Validates: Requirements 5.6**

  - [x] 7.13 编写消息持久化属性测试
    - **Property 7: 消息持久化往返** — 发送的消息可通过历史查询检索到，内容一致
    - **Validates: Requirements 3.3, 4.4**

- [x] 8. Checkpoint — 核心 API 验证
  - 确保 Talk/Broadcast/Move API 正常工作，Zone 约束、频率限制、边界检查、Energy 消耗逻辑正确。如有问题请向用户确认。

- [x] 9. HeartbeatMonitor — 心跳监控
  - [x] 9.1 实现 HeartbeatMonitor 模块
    - 创建 `server/src/modules/heartbeat-monitor.ts`，实现 `IHeartbeatMonitor` 接口
    - 心跳注册/注销：register / unregister
    - 心跳接收：onHeartbeat，记录时间戳和 Payload，持久化到 SQLite
    - 状态机实现：healthy → delayed → timeout → offline
      - 正常收到心跳：healthy
      - 超过 Heartbeat_Interval 未收到：delayed
      - 超过 Heartbeat_Timeout 未收到：timeout（更新 Sprite 状态为灰色半透明）
      - timeout 后额外一个 Timeout 周期仍未恢复：offline（断开 WebSocket，通知所有在线 Contestant）
      - timeout 状态下重新收到心跳：恢复为 healthy
    - 心跳历史维护：最近 100 条，超出移除最旧记录
    - 定时检查器：每隔 Heartbeat_Interval 检查所有在线 Contestant 的心跳状态
    - 心跳配置管理：updateConfig（interval 范围 1-30s，timeout 范围 3-120s）
    - 状态变更时通过 WebSocket 推送 `contestant.status` 和 `alert.heartbeat` 事件
    - 状态变更时调用 EventLogger 记录事件日志
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.14_

  - [x] 9.2 实现心跳 REST API
    - 创建 Express 路由 `POST /api/heartbeat`
    - 接受 JSON 格式心跳消息（payload；Contestant 身份由已认证 Key / WebSocket 接入状态推导）
    - 返回 HTTP 200（服务器时间戳 + 待处理事件数量）
    - 创建管理员心跳配置 API：GET/PUT `/api/admin/heartbeat/config`
    - 创建管理员心跳历史查询 API：GET `/api/admin/contestants/:id/heartbeat-history`
    - _Requirements: 9.3, 9.4, 9.5_

  - [x] 9.3 编写心跳记录往返属性测试
    - **Property 24: 心跳记录往返** — 发送心跳后查询返回最新数据且一致
    - **Validates: Requirements 9.4**

  - [x] 9.4 编写心跳配置范围属性测试
    - **Property 25: 心跳配置范围验证** — interval 1-30s、timeout 3-120s 范围内成功，超出拒绝
    - **Validates: Requirements 9.5**

  - [x] 9.5 编写心跳状态机属性测试
    - **Property 26: 心跳状态机正确性** — 验证 healthy→delayed→timeout→offline 和恢复转换
    - **Validates: Requirements 9.7, 9.8, 9.9**

  - [x] 9.6 编写心跳历史上限属性测试
    - **Property 27: 心跳历史记录上限** — 超过 100 条时最旧记录被移除
    - **Validates: Requirements 9.10**

  - [x] 9.7 编写心跳状态变更事件日志属性测试
    - **Property 28: 心跳状态变更事件日志** — healthy→timeout/offline 时创建事件日志
    - **Validates: Requirements 9.14**

- [x] 10. SkillDocManager 与 DocDistributor — Skill 文档与平台文档管理
  - [x] 10.1 实现 SkillDocManager 模块
    - 创建 `server/src/modules/skill-doc-manager.ts`，实现 `ISkillDocManager` 接口
    - 上传文档：解析 YAML front matter（使用 gray-matter），验证必填字段（name, version, description）
    - 文档 CRUD：getDocument / updateDocument / deleteDocument / listDocuments
    - 多版本管理：每次更新保存新版本到 `document_versions` 表
    - 版本历史查询与回滚：getVersionHistory / rollbackToVersion
    - 初始化时创建默认 Skill_Document（交流/广播/移动/状态查询技能）
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.11_

  - [x] 10.2 编写 Skill 文档 Metadata 验证属性测试
    - **Property 16: Skill 文档 Metadata 验证** — 缺少必填字段时拒绝，齐全时成功
    - **Validates: Requirements 7.2, 7.5**

  - [x] 10.3 编写 Skill 文档 CRUD 往返属性测试
    - **Property 17: Skill 文档 CRUD 往返** — 上传后查询一致，删除后不存在
    - **Validates: Requirements 7.1**

  - [x] 10.4 编写 Skill 文档版本回滚属性测试
    - **Property 18: Skill 文档版本回滚往返** — 回滚后内容与历史版本一致
    - **Validates: Requirements 7.6**

  - [x] 10.5 实现 DocDistributor 模块
    - 创建 `server/src/modules/doc-distributor.ts`，实现 `IDocDistributor` 接口
    - Skill 列表查询：返回 Metadata 摘要（不含完整正文）
    - Skill 安装：返回完整 Markdown 内容
    - 必装文档管理：HEARTBEAT.md / RULES.md / MESSAGING.md
    - 必装文档自动下发：Contestant 接入后自动推送
    - 文档更新通知：通过 WebSocket 推送 `doc.update` 事件
    - _Requirements: 7.7, 7.8, 7.10, 9.2, 12.1, 12.2, 12.3, 12.5_

  - [x] 10.6 编写 Skill 文档分发正确性属性测试
    - **Property 19: Skill 文档分发正确性** — 列表返回 Metadata 摘要，安装返回完整内容
    - **Validates: Requirements 7.7, 7.8**

  - [x] 10.7 编写必装文档自动下发属性测试
    - **Property 23: 必装文档自动下发** — 接入后自动下发三份必装文档
    - **Validates: Requirements 9.2, 12.3**

  - [x] 10.8 实现管理员 Skill 文档管理 API
    - 创建 `server/src/routes/admin-skills.ts`
    - POST `/api/admin/skills` — 上传 SKILL.md
    - PUT `/api/admin/skills/:id` — 编辑
    - DELETE `/api/admin/skills/:id` — 删除
    - GET `/api/admin/skills/:id/versions` — 版本历史
    - POST `/api/admin/skills/:id/rollback/:version` — 回滚
    - _Requirements: 7.4, 7.6_

  - [x] 10.9 实现 Agent Skill API 与平台文档 API
    - 创建 `server/src/routes/skills.ts`
    - GET `/api/skills` — 获取可用 Skill 列表
    - GET `/api/skills/:id/install` — 安装 Skill
    - 创建 `server/src/routes/docs.ts`
    - GET `/api/docs/:doc_name` — 获取平台文档
    - PUT `/api/admin/docs/:doc_name` — 管理员编辑平台文档
    - _Requirements: 7.7, 7.8, 12.4, 12.6_

  - [x] 10.10 编写平台文档更新通知属性测试
    - **Property 34: 平台文档更新通知** — 更新 RULES.md/MESSAGING.md 后所有在线 Contestant 收到通知
    - **Validates: Requirements 12.5**

  - [x] 10.11 编写平台文档查询往返属性测试
    - **Property 35: 平台文档查询往返** — 查询返回最新版本内容
    - **Validates: Requirements 12.6**

- [x] 11. Checkpoint — 心跳与文档系统验证
  - 确保心跳监控状态机正常运转，Skill 文档 CRUD/版本管理/分发正常，必装文档自动下发正常。如有问题请向用户确认。

- [x] 12. EventLogger 与 InteractionManager — 事件日志与观众互动
  - [x] 12.1 实现 EventLogger 模块
    - 创建 `server/src/modules/event-logger.ts`，实现 `IEventLogger` 接口
    - 事件记录：log 方法，持久化到 SQLite `events` 表
    - 事件查询：query 方法，支持分页和按事件类型过滤
    - 事件类型：contestant.online / contestant.offline / contestant.move / message.talk / message.broadcast / zone.change / heartbeat.timeout / heartbeat.offline / doc.update / system
    - _Requirements: 13.5_

  - [x] 12.2 实现 InteractionManager 模块
    - 创建 `server/src/modules/interaction-manager.ts`，实现 `IInteractionManager` 接口
    - 弹幕发送：sendBarrage，持久化到 SQLite，通过 WebSocket 推送 `barrage` 事件
    - 点赞/踩：vote，持久化到 SQLite，通过 WebSocket 推送 `vote.update` 事件
    - 投票统计：getVotes
    - 观众互动数据汇总：getAudienceFeedback
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

  - [x] 12.3 编写投票计数属性测试
    - **Property 29: 投票计数正确性** — 点赞/踩后对应计数增加 1
    - **Validates: Requirements 10.3**

  - [x] 12.4 编写观众互动数据查询属性测试
    - **Property 30: 观众互动数据查询** — 查询返回正确的汇总数据
    - **Validates: Requirements 10.5**

  - [x] 12.5 编写事件历史查询属性测试
    - **Property 40: 事件历史查询与过滤** — 返回的事件匹配过滤条件，支持分页
    - **Validates: Requirements 13.5**

  - [x] 12.6 实现事件与互动 REST API
    - 创建 `server/src/routes/events.ts`：GET `/api/events`
    - 创建 `server/src/routes/interaction.ts`：POST `/api/barrage`、POST `/api/contestants/:id/vote`、GET `/api/contestants/:id/votes`、GET `/api/audience-feedback`
    - _Requirements: 10.1, 10.3, 10.5, 13.5_

- [x] 13. Status API 与监控 — 状态查询与管理员监控
  - [x] 13.1 实现 Status API 端点
    - 创建 `server/src/routes/status.ts`
    - GET `/api/status/me` — 自身完整状态（Position, Zone, Zone_Type, Energy, 连接状态, 已安装 Skill 列表, Zone_Rule 摘要）
    - GET `/api/status/:id` — 其他 Contestant 公开状态（名称, Position, Zone, 连接状态）
    - GET `/api/contestants` — 当前/指定 Zone 内在线 Contestant
    - GET `/api/zones` — 所有 Zone 信息
    - GET `/api/zones/:id` — Zone 详情（含在线 Contestant 列表）
    - GET `/api/world` — World 概览（Map 尺寸, Zone 列表, 在线总数, 各 Zone 人数）
    - GET `/api/messages` — 消息历史（分页）
    - _Requirements: 8.3, 8.6, 8.7, 8.8, 8.9, 13.1, 13.2, 13.3, 13.4_

  - [x] 13.2 编写自身状态查询属性测试
    - **Property 36: 自身状态查询准确性** — 返回的所有字段与系统内部状态一致
    - **Validates: Requirements 8.6, 13.1**

  - [x] 13.3 编写其他 Contestant 公开状态查询属性测试
    - **Property 37: 其他 Contestant 公开状态查询** — 仅返回公开字段，不含私有信息
    - **Validates: Requirements 13.2**

  - [x] 13.4 编写 Zone 详情查询属性测试
    - **Property 38: Zone 详情查询准确性** — 返回的 Zone 信息与系统内部状态一致
    - **Validates: Requirements 13.3**

  - [x] 13.5 编写 World 概览查询属性测试
    - **Property 39: World 概览查询准确性** — 返回的 World 信息与系统内部状态一致
    - **Validates: Requirements 13.4**

  - [x] 13.6 实现管理员监控 API
    - 创建 `server/src/routes/admin-monitor.ts`
    - GET `/api/admin/monitor` — 平台运行状态概览（在线数量, Zone 人数分布, API 调用频率统计, 心跳异常列表）
    - _Requirements: 13.6_

- [x] 14. API 认证中间件与 API 文档
  - [x] 14.1 实现 API 认证中间件
    - 创建 `server/src/middleware/auth.ts`
    - 从 `Authorization: Bearer <key>` Header 提取 Key
    - 调用 AuthManager.validateKey 验证
    - 无效 Key 返回 HTTP 401 + `AUTH_INVALID_KEY`
    - 未携带 Key 返回 HTTP 401 + `AUTH_MISSING_KEY`
    - 将所有 Agent API 路由挂载认证中间件
    - _Requirements: 8.2_

  - [x] 14.2 编写 API 认证拦截属性测试
    - **Property 20: API 认证拦截** — 无效 Key 返回 401，有效 Key 正常处理
    - **Validates: Requirements 8.2**

  - [x] 14.3 编写统一错误响应格式属性测试
    - **Property 21: 统一错误响应格式** — 所有错误响应符合 `{ "error": { "code", "message" } }` 格式
    - **Validates: Requirements 8.10**

  - [x] 14.4 实现 API 文档端点
    - 创建 Express 路由 GET `/api/docs`，返回 OpenAPI/Swagger 格式 API 文档
    - 可使用 swagger-jsdoc 或手写 OpenAPI JSON
    - _Requirements: 8.12_

- [x] 15. Checkpoint — 后端完整性验证
  - 确保所有后端 API 端点可用，认证中间件正常拦截，速率限制生效，错误响应格式统一。如有问题请向用户确认。

- [x] 16. 前端 — WebSocket 客户端与状态管理
  - [x] 16.1 实现 WebSocket 客户端
    - 创建 `client/src/services/ws-client.ts`
    - WebSocket 连接管理：连接、断开、指数退避重连（初始 1s，最大 30s）
    - 消息收发：发送 ClientMessage，接收 ServerEvent / ServerResponse
    - 事件分发：将收到的事件分发到 Zustand store
    - _Requirements: 8.4_

  - [x] 16.2 实现 Zustand 状态管理
    - 创建 `client/src/stores/` 目录
    - `gameStore.ts`：World 状态（Map, Zones, Contestants, Positions）
    - `messageStore.ts`：消息列表（Talk, Broadcast, Barrage）
    - `uiStore.ts`：UI 状态（选中的 Contestant, 面板显示状态, 缩放级别）
    - WebSocket 事件处理：根据事件类型更新对应 store
    - _Requirements: 6（前端状态管理）_

- [x] 17. 前端 — Phaser 3 游戏渲染
  - [x] 17.1 实现 BootScene 与 GameScene
    - 创建 `client/src/game/` 目录
    - `BootScene.ts`：资源预加载（背景图、Sprite 素材、Zone 图标）
    - `GameScene.ts`：主场景，管理渲染层级（MapLayer → ZoneLayer → SpriteLayer → EffectLayer → UILayer）
    - Map 渲染：背景图片，Zone 边界线、名称标签、Zone_Type 图标
    - 画面缩放和平移操作（鼠标滚轮缩放、拖拽平移）
    - 自适应布局（响应窗口尺寸变化）
    - 目标帧率 ≥30 FPS
    - _Requirements: 6.1, 6.2, 6.7, 6.8, 6.10, 2.9, 2.10_

  - [x] 17.2 实现 SpriteManager
    - 创建 `client/src/game/sprite-manager.ts`
    - Contestant Sprite 创建/更新/销毁
    - Sprite 显示：选手名称标签、连接状态标识
    - 心跳颜色编码：绿色=正常、黄色=延迟、红色=超时
    - 移动补间动画：300ms-1000ms 平滑移动
    - 精力耗尽状态标识
    - 超时状态样式（灰色半透明）
    - 点击 Sprite 弹出 Attribute_Panel
    - _Requirements: 6.3, 6.4, 6.9, 1.8, 9.7, 9.11, 11.7_

  - [x] 17.3 实现 UIOverlay — 对话气泡、广播横幅、弹幕
    - 创建 `client/src/components/UIOverlay.tsx`
    - 对话气泡：Talk 消息显示在发送者 Sprite 上方，3-5 秒后自动消失
    - 广播横幅：Broadcast 消息在画面顶部全局横幅样式展示
    - 弹幕滚动：Barrage 消息以滚动文字叠加渲染在游戏画面上
    - _Requirements: 6.5, 6.6, 10.2_

- [x] 18. 前端 — Attribute_Panel 与管理面板
  - [x] 18.1 实现 Attribute_Panel 组件
    - 创建 `client/src/components/AttributePanel.tsx`
    - 展示选手详细状态：名称、Position、所在 Zone 和 Zone_Type、Energy 值、连接状态
    - 心跳详情：最近心跳时间、当前延迟、CPU 负载、内存使用、响应延迟
    - 点赞/踩数显示
    - 当前区域 API 可用状态
    - _Requirements: 6.9, 9.12, 10.4, 11.10_

  - [x] 18.2 实现心跳概览面板
    - 创建 `client/src/components/HeartbeatOverview.tsx`
    - 列表形式展示所有 Contestant 的心跳状态、最近心跳时间、关键 Payload 指标
    - 心跳状态告警：超时/离线时屏幕边缘闪烁提示
    - _Requirements: 9.13, 9.14_

  - [x] 18.3 实现管理员面板
    - 创建 `client/src/components/AdminPanel.tsx`
    - Key 管理界面：生成、查看、吊销、重新生成
    - Zone 管理界面：创建、编辑、删除 Zone，设置名称/坐标/Zone_Type
    - Zone_Type 管理：创建自定义 Zone_Type，编辑 Zone_Rule
    - Skill 文档管理：上传、编辑、查看、删除、版本管理
    - 平台文档编辑：RULES.md / MESSAGING.md 编辑
    - 心跳配置：调整 Heartbeat_Interval 和 Heartbeat_Timeout
    - Map 配置：背景图片、Zone 视觉样式
    - 监控面板：平台运行状态概览
    - _Requirements: 1.2, 2.3, 2.5, 2.9, 7.4, 9.5, 11.3, 12.4, 13.6_

  - [x] 18.4 实现观众互动 UI
    - 弹幕输入框与发送功能
    - 点赞/踩按钮（点击 Sprite 后显示）
    - _Requirements: 10.1, 10.3, 10.4_

- [x] 19. Checkpoint — 前端渲染验证
  - 确保 Phaser 3 游戏画面正常渲染，Sprite 移动动画流畅，对话气泡/广播横幅/弹幕正常显示，管理面板功能可用。如有问题请向用户确认。

- [x] 20. 前后端集成与事件联调
  - [x] 20.1 集成 WebSocket 事件流
    - 前端 WSClient 连接后端 WebSocket 服务器
    - 认证流程：前端发送 auth 消息 → 后端验证 → 推送 world.state → 前端初始化游戏场景
    - 实时事件同步：contestant.join/leave/move/status、talk.message、broadcast.message、energy.update、zone.rule.update、doc.update、barrage、vote.update、alert.heartbeat
    - 确保所有 WebSocket 事件正确触发前端 Zustand store 更新和 Phaser 渲染
    - _Requirements: 8.4, 8.5_

  - [x] 20.2 集成 REST API 调用
    - 前端管理面板调用管理员 API（Key/Zone/Skill/文档/心跳配置/监控）
    - 前端观众互动调用弹幕/投票 API
    - 确保认证 Header 正确传递
    - _Requirements: 8.1, 8.2_

- [x] 21. Final Checkpoint — 全系统验证
  - 确保所有后端 API 端点正常工作，WebSocket 实时事件推送正确，前端游戏渲染流畅，管理面板功能完整，观众互动正常。所有属性测试和单元测试通过。如有问题请向用户确认。

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Property 1-40)
- Unit tests validate specific examples and edge cases
- 后端使用 TypeScript (Node.js)，前端使用 TypeScript (React + Phaser 3)
- 属性测试使用 `fast-check` 库，每个属性测试至少 100 次迭代
