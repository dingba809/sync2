# 多网盘任务与配置化改造 — 设计文档

日期：2026-09-02
状态：已确认

## 1. 目标与范围

在现有 sync2（本地目录单向镜像备份到网盘）基础上，完成四项增强：

1. **网盘配置集中到配置文件**：各网盘的配置（如 Google 的 OAuth clientId/clientSecret/redirectUri）统一存到配置文件，新增网盘时只需加配置项 + 注册驱动。
2. **同步任务可编辑**。
3. **一个任务可备份到多个网盘**（多备份目标：任务 = 本地目录 + 多个「账号+远程目录」）。
4. **同步进度可视化**：任务状态显示「同步中」，点开查看每个目标的上传文件详细进度。

非目标（YAGNI）：双向同步、字节级进度百分比、网盘驱动插件化动态加载、配置热更新。

## 2. 网盘配置文件

新增两个文件：

- `server/drives.config.example.json`（提交到仓库，作为模板）
- `drives.config.json`（实际配置，加入 `.gitignore`，含密钥不上传）

模板内容：

```json
{
  "google": {
    "clientId": "",
    "clientSecret": "",
    "redirectUri": "http://localhost:3000/api/auth/google/callback"
  },
  "quark": {}
}
```

`config.ts` 的 `loadConfig` 读取配置来源，优先级（高→低）：

1. `{项目根}/drives.config.json`
2. `{dataDir}/drives.config.json`
3. 环境变量（`GOOGLE_CLIENT_ID` 等，向后兼容）

`Config` 接口的 `googleClientId` / `googleClientSecret` / `googleRedirectUri` 字段保持不变（`provider-factory.ts`、`auth/google.ts`、`routes.ts` 无需改），仅来源从「纯环境变量」改为「配置文件优先、环境变量回退」。

夸克 `{}` 空对象（扫码登录无需密钥）。未来新增网盘：在 `providers/` 加驱动 + 在此 JSON 加配置项 + 在 `provider-factory.ts` 注册。

## 3. 数据模型（多备份目标）

新增表 `task_targets`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 目标 UUID |
| `task_id` | TEXT | 所属任务 |
| `account_id` | TEXT | 网盘账号 |
| `remote_path` | TEXT | 该目标在网盘上的目录 |
| `created_at` | INTEGER | 创建时间 |

改动：

- `tasks` 表移除 `account_id`、`remote_path`（保留 `id/name/local_path/schedule/enabled/last_status/created_at`）。
- `file_snapshots` 的 key 从 `task_id + rel_path` 改为 `target_id + rel_path`（每个目标独立快照，同一文件在不同网盘的 remoteId 不同）。
- `run_history` 表新增 `target_id` 字段（保留 `task_id` 用于按任务聚合查询）：每次对某个 target 的同步写一条记录，任务级汇总由多个 target 记录聚合得出。

**迁移策略**（`db.ts` 的 `migrate` 检测旧 schema 后执行）：

1. 建 `task_targets` 表。
2. 遍历旧 `tasks`（含 `account_id` 列），为每个任务生成一个 target（`account_id` + `remote_path` 原样迁移），得到 target_id。
3. 重建 `tasks` 表（去掉 `account_id`/`remote_path`）。
4. `file_snapshots` 旧数据直接丢弃、重建为 `target_id` 版本（快照可重新生成，且 provider 秒传兜底，不会重复上传）。

数据层新增/调整函数：`insertTarget` / `listTargets(taskId)` / `deleteTargets(taskId)`（删除任务时级联删除 targets 及其快照），`listSnapshots` 等快照函数参数从 `taskId` 改为 `targetId`。

## 4. 后端同步流程改动

- `runSync` 的参数 `taskId` 语义改为 `targetId`（快照按 target 存），新增可选 `onProgress` 回调。
- `runTaskById` 改为：
  1. 置任务 `last_status = 'running'`，初始化 `TaskProgress`。
  2. 遍历该任务的 `targets`，对每个 target 用对应账号创建 provider，跑一次 `runSync`，实时更新进度。
  3. 汇总：所有 target 成功 → `last_status = 'success'`，否则 `failed`。
  4. 单个 target 失败不中断其余 target（各自 try/catch，记录错误）。
- 删除账号时，同时 unregister 关联任务的 cron（现有逻辑保留），并级联删除相关 targets。

## 5. 进度机制

**后端进度模型**（内存态，不落库）：

```ts
interface TargetProgress {
  targetId: string;
  accountName: string;
  remotePath: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  currentFile: string | null;
  uploadedCount: number;
  totalUpload: number;
  deletedCount: number;
  totalDelete: number;
}

interface TaskProgress {
  taskId: string;
  status: 'running' | 'success' | 'failed';
  targets: TargetProgress[];
}
```

- `runSync` 增加 `onProgress`（当前文件 + 上传/删除计数）。
- `routes.ts` 维护 `progressStore: Map<taskId, TaskProgress>` 与订阅者集合，进度变化即广播。
- 新增端点：
  - `GET /api/tasks/:id/progress/stream`（SSE，实时推送）
  - `GET /api/tasks/:id/progress`（兜底拉取当前值）
- 任务 `last_status` 增加 `running` 枚举值。

## 6. 前端交互

- **任务编辑**：`TaskFormModal` 支持「新建 / 编辑」两种模式。编辑时预填任务名、本地目录、调度、启用，以及多个备份目标（每行 = 账号下拉 + 远程目录输入 + 删除按钮，「添加目标」动态增行）。保存走 POST（新建）或 PUT（编辑，后端重建 targets）。
- **任务列表**：状态列渲染 `running` 为「同步中」（蓝色 + loading 图标）。
- **任务详情**：任务行加「详情」按钮，点开 Drawer 显示任务基本信息、所有备份目标、运行中实时进度（SSE 订阅 `/api/tasks/:id/progress/stream`）。

## 7. 错误处理与测试

- 单个 target 同步失败不中断其余 target；任务 `last_status` 汇总为 `failed`，`run_history` 记录每个 target 的结果。
- 配置文件缺失/格式错误：回退环境变量；若 Google 配置全空，`/api/auth/google/url` 仍返回 400 明确提示（现有逻辑保留）。
- 测试：`db.ts`（targets CRUD、级联删除、快照按 target）、`planner/executor` 沿用，`runTaskById` 多 target 流程用 fake provider 覆盖，前端编辑表单逻辑。

## 8. 涉及文件

- 新增：`server/drives.config.example.json`、`drives.config.json`（gitignore）
- 改：`server/config.ts`、`server/db.ts`、`server/engine/executor.ts`、`server/routes.ts`、`shared/types.ts`、`src/api.ts`、`src/pages/TasksPage.tsx`、`src/components/TaskFormModal.tsx`、新增 `src/components/TaskDetailDrawer.tsx`、`.gitignore`
