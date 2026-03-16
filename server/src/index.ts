// =============================================================================
// XTION_TheFool0 — 服务器入口
// Requirements: 8.1, 8.4
// =============================================================================

import http from 'http';
import { app, errorHandler } from './app';
import { setupWebSocket } from './ws';
import { initializeDatabase } from './db';

const PORT = Number(process.env.PORT) || 3000;

// 1. 初始化数据库
initializeDatabase();

// 2. 挂载错误处理中间件（必须在所有路由之后）
app.use(errorHandler);

// 3. 创建 HTTP 服务器
const server = http.createServer(app);

// 4. 挂载 WebSocket 服务器（共享同一 HTTP 服务器）
setupWebSocket(server);

// 5. 启动
server.listen(PORT, () => {
  console.log(`[XTION] HTTP server listening on http://localhost:${PORT}`);
  console.log(`[XTION] WebSocket server listening on ws://localhost:${PORT}/ws`);
});

server.on('error', (err) => {
  console.error('[XTION] Server error:', err);
  process.exit(1);
});
