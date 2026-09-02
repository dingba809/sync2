# sync2 — 云盘增量同步备份工具

> 把本地目录单向镜像备份到 Google Drive 和夸克网盘，自带本地网页管理界面。

## ✨ 项目亮点

- **本地 Web 界面**：浏览器访问 `http://127.0.0.1:3000`，任务 / 账号 / 日志一目了然。
- **单向镜像备份**：以本地为准，本地新增、修改、删除都会同步到网盘对应位置。
- **增量检测**：按「文件大小 + 修改时间」快速比对，未变化的文件跳过，支持秒传。
- **大文件友好**：Google Drive（resumable）与夸克（OSS 分片）均采用流式分片上传，不整读内存。
- **多任务独立调度**：多对「本地目录 ↔ 网盘目录」各自配置，支持手动触发或 cron 定时。
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

数据（SQLite、主密钥）持久化在 `sync2-data` 卷，要备份的宿主机目录通过 `LOCAL_PATH` 环境变量挂载到容器内 `/backup`：

```bash
LOCAL_PATH=/你的/本地/目录 docker compose up -d
```

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
5. 拿到客户端 ID 与客户端密钥后，通过环境变量注入：

```bash
GOOGLE_CLIENT_ID=你的客户端ID \
GOOGLE_CLIENT_SECRET=你的客户端密钥 \
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback \
npm start
```

Docker 部署时写进 `.env`：

```bash
GOOGLE_CLIENT_ID=你的客户端ID
GOOGLE_CLIENT_SECRET=你的客户端密钥
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### 环境变量总览

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `3000` |
| `HOST` | 监听地址 | `127.0.0.1`（仅本机访问） |
| `DATA_DIR` | 数据目录（SQLite、主密钥） | `./data` |
| `GOOGLE_CLIENT_ID` | Google OAuth 客户端 ID | 空 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 客户端密钥 | 空 |
| `GOOGLE_REDIRECT_URI` | Google OAuth 回调地址 | `http://localhost:3000/api/auth/google/callback` |

> 安全提示：默认只监听 `127.0.0.1`，请勿随意把 `HOST` 设为 `0.0.0.0` 暴露到公网。若确需远程访问，请务必放在反向代理 + 鉴权之后。

## 🧭 使用流程

1. **添加网盘账号**：Google 走 OAuth 授权，夸克走扫码。
2. **新建同步任务**：填写任务名、选择账号、本地目录（绝对路径）、远程目录、调度（cron，留空为手动）。
3. **立即同步**：点任务行的「同步」按钮，或在「日志」页查看实时进度。

## 📁 项目结构

```
sync2/
├── shared/types.ts          # 前后端共享类型、DriveProvider 接口
├── server/                  # 后端（Fastify）
│   ├── index.ts             # 入口
│   ├── config.ts            # 配置与主密钥管理
│   ├── crypto.ts            # AES-256-GCM 加解密
│   ├── db.ts                # SQLite 数据层
│   ├── scheduler.ts         # cron 定时调度
│   ├── provider-factory.ts  # 网盘驱动工厂
│   ├── routes.ts            # REST API + SSE 日志流
│   ├── providers/           # google.ts / quark.ts 网盘驱动
│   ├── auth/                # google.ts / quark.ts 登录流程
│   └── engine/              # scanner / planner / executor 同步引擎
├── src/                     # 前端（React + Vite + Ant Design）
│   ├── api.ts               # API 客户端
│   ├── App.tsx / main.tsx
│   ├── pages/               # 任务 / 账号 / 日志
│   └── components/          # 任务表单 / 夸克扫码弹窗
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
