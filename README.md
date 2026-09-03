# sync2 — 云盘增量同步备份工具

> 把本地目录单向镜像备份到 Google Drive 和夸克网盘，自带本地网页管理界面。

## ✨ 项目亮点

- **本地 Web 界面**：浏览器访问 `http://127.0.0.1:3000`，任务 / 账号 / 日志一目了然。
- **单向镜像备份**：以本地为准，本地新增、修改、删除都会同步到网盘对应位置。
- **增量检测**：按「文件大小 + 修改时间」与本地快照快速比对；首次完整核对远端，后续同步跳过远端全量扫描。
- **大文件友好**：Google Drive（resumable）与夸克（OSS 分片）均采用流式分片上传，不整读内存。
- **多备份目标**：一个任务可同时备份到多个网盘（每个目标 = 账号 + 远程目录），互不干扰。
- **实时进度**：同步时状态显示「同步中」，点开详情可看每个目标的上传/删除详细进度。
- **同步状态与完成时间**：任务列表实时显示「同步中 / 成功 / 失败」和最近一次同步完成时间。
- **日志筛选**：日志支持按任务和日期范围筛选，便于定位历史同步记录。
- **完成通知**：可通过 Telegram 或 Bark 接收同步成功/失败、上传数与删除数摘要；密钥加密保存在本地。
- **任务可编辑**：任务名、本地目录、调度、备份目标均可在界面随时增删改。
- **多任务独立调度**：多个任务各自配置，支持手动触发或 cron 定时。
- **凭据加密**：Google refresh_token / 夸克 Cookie 用 AES-256-GCM 加密后落盘，主密钥独立保存。

## 📦 环境要求

- Node.js 20+
- （可选）Docker / Docker Compose
- Google Drive 需要自建 OAuth 客户端（见下文「配置 Google OAuth」）

## 🚀 快速开始

```bash
git clone https://github.com/dingba809/sync2.git
cd sync2
npm install
npm run build
npm start
```

打开浏览器访问 <http://127.0.0.1:3000>。

开发模式（前端热更新 + 后端热重载）：

```bash
npm run dev
```

## 🐳 Docker 部署

```bash
docker compose up -d
```

首次使用 Docker 前，请先在 Compose 文件同级目录创建网盘配置。该文件会以只读方式挂载到容器的 `/data/drives.config.json`，不会被打进镜像，也不会提交到 Git：

```bash
cp server/drives.config.example.json drives.config.json
# 编辑 drives.config.json，填写 Google OAuth 凭据（夸克无需预先填写）
docker compose up -d
```

配置文件中的 Google OAuth 值优先于 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 `GOOGLE_REDIRECT_URI` 环境变量。若只想使用环境变量，也仍需保留一个有效的 `drives.config.json` 文件，例如直接使用未修改的模板。

数据（SQLite、主密钥）持久化在 `sync2-data` 卷，要备份的宿主机目录通过 `LOCAL_PATH` 环境变量挂载到容器内 `/backup`：

```bash
LOCAL_PATH=/你的/本地/目录 docker compose up -d
```

夸克的大目录同步会在请求之间默认间隔 `75ms`，避免大量文件触发 OSS 限流。若网络环境仍出现限流，可在启动前适当调大间隔，例如：

```bash
QUARK_REQUEST_INTERVAL_MS=200 docker compose up -d
```

该变量仅影响夸克网盘请求，不影响 Google Drive。

容器内端口默认 3000，仅映射到宿主机 `127.0.0.1`（不暴露公网）。任务里「本地目录」填容器内路径（如 `/backup`）。

## 🔑 配置

### 夸克网盘（扫码登录，无需额外配置）

界面「网盘账号 → 添加夸克」会弹出二维码，用夸克 App 扫码授权即可。

### Google Drive（OAuth 2.0，需自建凭据）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建项目。
2. 启用 **Google Drive API**。
3. 配置 **OAuth 同意屏幕**（用户类型选「外部」，把你自己加为测试用户）。
4. 在 **凭据 → 创建凭据 → OAuth 客户端 ID**，应用类型选「Web 应用」，
   「已获授权的重定向 URI」填 `http://localhost:3000/api/auth/google/callback`。
5. 拿到客户端 ID 与客户端密钥后，复制 `server/drives.config.example.json` 为项目根目录的 `drives.config.json` 并填入：

```json
{
  "google": {
    "clientId": "你的客户端ID",
    "clientSecret": "你的客户端密钥",
    "redirectUri": "http://localhost:3000/api/auth/google/callback"
  },
  "quark": {}
}
```

`drives.config.json` 已加入 `.gitignore`（含密钥不上传）。新增网盘时只需在该文件加一项配置，并在 `server/providers/` 加对应驱动。

> 兼容旧方式：未提供配置文件时，仍可用 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` 环境变量。

### 同步通知（Telegram / Bark）

在网页侧边栏打开「设置」即可配置通知。两种渠道可以独立启用，保存后会在每个同步任务结束时发送成功或失败状态、上传文件数和删除文件数。

- **Telegram**：填写 Bot Token 与接收消息的 Chat ID。
- **Bark**：填写 Bark 服务器地址（官方服务为 `https://api.day.app`）和 Device Key。

Bot Token、Chat ID 与 Bark Device Key 会通过 AES-256-GCM 加密后保存，不会在设置页面回显；重新保存时相应字段留空即可保留既有密钥。

### 大目录同步性能

在网页「设置」中可调整夸克上传并发数（`1–6`，默认 `3`）。并发仅用于不同文件，单个文件仍使用稳定的串行分片上传；每个任务独立使用该上限。已有本地快照的后续同步不会主动识别网盘端的手工变更，快照丢失或新建任务时会自动完整核对远端。

### 环境变量总览

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `3000` |
| `HOST` | 监听地址 | `127.0.0.1`（仅本机访问） |
| `DATA_DIR` | 数据目录（SQLite、主密钥） | `./data` |
| `GOOGLE_CLIENT_ID` | Google OAuth 客户端 ID（配置文件缺失时的回退） | 空 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 客户端密钥（配置文件缺失时的回退） | 空 |
| `GOOGLE_REDIRECT_URI` | Google OAuth 回调地址（配置文件缺失时的回退） | `http://localhost:3000/api/auth/google/callback` |
| `QUARK_REQUEST_INTERVAL_MS` | 夸克请求间隔（毫秒），用于大目录同步限流保护 | `75` |

> 安全提示：默认只监听 `127.0.0.1`，请勿随意把 `HOST` 设为 `0.0.0.0` 暴露到公网。若确需远程访问，请务必放在反向代理 + 鉴权之后。

## 🧭 使用流程

1. **添加网盘账号**：Google 走 OAuth 授权，夸克走扫码。
2. **新建同步任务**：填写任务名、本地目录（绝对路径）、调度（cron，留空为手动），并添加一个或多个备份目标（每个目标 = 网盘账号 + 远程目录）。
3. **立即同步**：点任务行的「同步」按钮，状态列显示「同步中」；点「详情」可实时查看每个目标的上传/删除进度。
4. **编辑任务**：点「编辑」随时修改任务名、目录、调度或增删备份目标。
5. **设置通知**：在「设置」中启用并填写 Telegram 或 Bark 配置，任务完成时自动接收摘要。

## 📁 项目结构

```
sync2/
├── shared/types.ts              # 前后端共享类型、DriveProvider 接口
├── drives.config.json           # 网盘配置（gitignore，含密钥）
├── server/
│   ├── drives.config.example.json  # 网盘配置模板
│   ├── index.ts                 # 入口
│   ├── config.ts                # 配置与主密钥管理
│   ├── crypto.ts                # AES-256-GCM 加解密
│   ├── notifications.ts          # Telegram / Bark 同步完成通知
│   ├── db.ts                    # SQLite 数据层（含 task_targets 多目标）
│   ├── scheduler.ts             # cron 定时调度
│   ├── provider-factory.ts      # 网盘驱动工厂
│   ├── routes.ts                # REST API + SSE 日志/进度流
│   ├── providers/               # google.ts / quark.ts 网盘驱动
│   ├── auth/                    # google.ts / quark.ts 登录流程
│   └── engine/                  # scanner / planner / executor 同步引擎
├── src/                         # 前端（React + Vite + Ant Design）
│   ├── api.ts                   # API 客户端
│   ├── App.tsx / main.tsx
│   ├── pages/                   # 任务 / 账号 / 日志 / 设置
│   └── components/              # 任务表单 / 任务详情 / 夸克扫码弹窗
├── Dockerfile / docker-compose.yml
└── package.json / tsconfig.json / vite.config.ts / build-server.mjs
```

## 🛠️ 开发

```bash
npm run test        # vitest 单元测试
npm run typecheck   # tsc 类型检查
npm run build       # 前端打包 + 后端 esbuild 打包
```

同步引擎核心逻辑在 `server/engine/`：`scanner`（本地扫描）→ `planner`（三方比对）→ `executor`（执行上传/删除）。

## ⚠️ 已知限制

- 增量判定基于「大小 + 修改时间」，若网盘上的备份文件被外部直接改动（内容漂移），暂不会自动恢复。
- Google Drive 同名文件可共存，删除旧版本失败时可能残留重复文件（会记录到日志）。

## 📝 License

MIT
