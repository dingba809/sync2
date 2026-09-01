# 云盘增量同步备份工具 — 设计文档

日期：2026-09-01
状态：已确认

## 1. 目标与范围

构建一个「本地目录 → 云盘」的增量同步备份工具，提供友好的本地 Web 界面。首期实现两个网盘驱动：Google Drive 与夸克网盘。

- 形态：本地 Web 应用（后端常驻 + 浏览器访问）
- 技术栈：TypeScript 全栈
- 同步方向：单向镜像（本地为准，本地删除则同步删除网盘对应文件）
- 增量检测：大小 + mtime 优先，哈希兜底
- 触发方式：手动 + 定时
- 任务模型：多任务（多对「本地目录 ↔ 网盘目录」配对，各自独立调度）
- 部署：支持 Docker 部署

非目标（YAGNI）：双向同步、跨账号迁移、版本历史/回收站恢复、文件加密、实时文件监控（watch）、远程增量下载。

## 2. 总体架构与目录结构

单进程模型：Fastify 同时提供 REST API 并托管前端静态文件；node-cron 常驻后台定时调度；SQLite 通过 better-sqlite3 同步访问。

```
sync2/
├── shared/types.ts              # 前后端共享 TS 类型
├── server/
│   ├── index.ts                 # Fastify 入口（挂载路由 + 静态文件）
│   ├── config.ts                # 配置与数据目录定位
│   ├── db/                      # SQLite 连接、schema、迁移
│   ├── providers/
│   │   ├── types.ts             # DriveProvider 接口定义
│   │   ├── google.ts
│   │   └── quark.ts
│   ├── auth/                    # google.ts / quark.ts 登录流程
│   ├── engine/
│   │   ├── scanner.ts           # 本地目录扫描
│   │   ├── planner.ts           # 三方比对，生成上传/删除计划
│   │   └── executor.ts          # 执行计划 + 断点续传
│   ├── scheduler.ts             # 定时触发
│   └── routes/                  # tasks / accounts / auth / logs
├── src/                         # 前端 React + Vite
│   ├── api.ts
│   ├── pages/  TasksPage / AccountsPage / LogsPage
│   └── components/
├── Dockerfile
├── docker-compose.yml
├── package.json / tsconfig.json / vite.config.ts
```

## 3. 数据模型（SQLite）

| 表 | 用途 |
|---|---|
| `accounts` | 网盘账号：`provider`(google/quark)、`display_name`、`credential`(AES 加密 JSON)、`quota` |
| `tasks` | 同步任务：`name`、`account_id`、`local_path`、`remote_path`、`schedule`、`enabled`、`last_status` |
| `file_snapshots` | 上次同步的远程状态快照，`task_id + rel_path` 唯一，存 `size/mtime/hash/remote_id` |
| `run_history` | 每次同步运行记录：起止时间、状态、上传/删除计数、错误信息 |
| `logs` | 运行日志流：`task_id`、`level`、`message`、`created_at` |

凭据加密：首次启动生成主密钥（存于数据目录，600 权限），用 AES-256-GCM 加密 `credential` 字段（Google refresh_token、夸克 Cookie）。

## 4. Provider 抽象接口

统一抽象，新增网盘只实现该接口：

```ts
interface RemoteEntry {
  id: string;      // 网盘文件 ID（夸克 fid / Google fileId）
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  hash?: string;   // 网盘侧哈希（Google md5Checksum / 夸克 sha1）
}

interface DriveProvider {
  listFolder(folderId: string): Promise<RemoteEntry[]>;
  ensureFolder(parentId: string, name: string): Promise<string>;
  uploadFile(localPath: string, parentId: string, name: string): Promise<RemoteEntry>;
  deleteEntry(id: string): Promise<void>;
  getQuota(): Promise<{ total: number; used: number }>;
}
```

远程目录用「根 folderId + 相对路径」逐级 `ensureFolder` 解析，屏蔽 Google（ID 扁平结构）与夸克（fid + 路径）的差异。

## 5. 同步引擎流程

每次运行（手动或定时）针对单个任务：

1. **扫描本地**：递归遍历 `local_path`，生成 `Map<relPath, {size, mtime}>`。
2. **读取快照**：从 `file_snapshots` 读该任务远程状态。
3. **列远程**：`listFolder` 逐级拉取，得到真实远程 `Map<relPath, RemoteEntry>`。
4. **三方比对**，生成计划：

| 场景 | 动作 |
|---|---|
| 本地有，快照无，远程无 | 上传 |
| 本地有，快照有，size/mtime 变化 | 算哈希比对 → 不同则上传 |
| 本地有，快照有，size/mtime 一致 | 远程在则跳过；远程被删则重传 |
| 本地无，快照有 | 删除远程 |
| 本地无，远程有（快照无） | 删除远程（镜像语义） |

5. **执行**：按「建目录 → 上传 → 删除」顺序，逐文件更新快照与日志。
6. **哈希兜底**：仅对 size/mtime 变化且 size 相同的文件计算本地 MD5。上传前走秒传（夸克 `update/hash`、Google 比对 `md5Checksum`），一致则跳过实际上传。
7. **断点续传**：进度写入 `run_history`，中途失败从已完成项恢复；夸克分片上传（<5MB 单分片，≥5MB 4MB/片）失败按片重试。

## 6. 认证流程

**Google Drive（OAuth 2.0）**：前端点击「添加 Google 账号」→ 后端生成授权 URL（用户在 Google Cloud Console 建 OAuth client，配置 client_id/secret）→ 回调 `/auth/google/callback` 换 token → refresh_token 加密存储 → 过期自动刷新。

**夸克网盘（扫码登录）**：`getTokenForQrcodeLogin` 获取二维码 token → 前端 qrcode 渲染 → 后端 500ms 轮询 `getServiceTicketByQrcodeToken` → 拿 service_ticket → `account/info` 换 Cookie → 加密存储。Cookie 过期提示重新扫码。

## 7. 前端界面

- 任务页：任务卡片列表（名称、账号、路径、调度、启用开关、立即同步、上次状态）。
- 任务详情/新建：配置本地目录（选择器）、远程目录、调度。
- 账号页：账号列表（类型、昵称、配额、状态），添加 Google/夸克按钮，夸克扫码弹窗。
- 日志页：按任务过滤的实时日志，SSE 推送。
- 技术：Vite + React + Ant Design，后端同源托管静态文件。

## 8. 错误处理

- Provider 错误分类：`AuthError`（提示重新授权）、`RateLimitError`（指数退避重试）、`NetworkError`（重试）、`FatalError`（夸克致命码，标记不重试）。
- 同步中断：单文件失败记录并继续，结束汇总写入 `run_history`。
- 重试：网络/限流指数退避重试 3 次；致命错误跳过并高亮。
- 配额：上传前检查 `getQuota`，不足则中止提示。

## 9. Docker 部署

- 多阶段构建：stage1 用 node 构建前后端，stage2 用 `node:20-alpine` 精简镜像只保留产物。
- 数据持久化：`/data` volume 存 SQLite、主密钥、配置。
- 本地目录挂载：要备份的宿主机目录通过 volume 挂载进容器（如 `/backup`），任务中配置容器内路径。
- 端口：默认 3000，可用环境变量覆盖。
- docker-compose.yml：定义服务、端口映射、volumes、restart 策略。
- 环境变量：`PORT`、`DATA_DIR`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI`（OAuth 回调地址按宿主机访问地址配置）。

## 10. 测试策略（vitest）

- 单元测试：`planner` 三方比对（覆盖 5 种场景 + 边界）、`scanner`、哈希判定。
- Provider 测试：mock HTTP 客户端验证请求/响应映射。
- 集成测试：SQLite 快照读写、engine 端到端（临时目录 + fake provider）。
- 手动验证：真实 Google/夸克账号跑小目录同步。
