# Lemon Mail

基于 `lemonhub.net` 的托管式域名邮箱：邮件直接接收并存储在本站数据库，每个邮箱 10MB 配额。前端采用 Vue 3、Tailwind CSS 和 TypeScript，后端采用 Hono 和 TypeScript，部署在 Cloudflare（Workers + Pages + D1 + Email Routing）。

- 前端：https://mail.lemonhub.net
- API：https://api.lemonhub.net

## 本地运行

```bash
npm install
npm run db:migrate:local   # 首次或 schema 变更后
npm run dev
```

网页运行在 `http://localhost:5173`，Worker API 运行在 `http://localhost:8787`（本地 D1 状态保存在 `.wrangler.state`）。

生产环境需配置 Worker Secret `TURNSTILE_SECRET`（Cloudflare Turnstile）；未配置时本地可跳过人机校验。可选 Secret / 变量见下表。

## 部署

```bash
npm run db:migrate     # 应用 D1 migration 到远程数据库
# wrangler secret put TURNSTILE_SECRET
# 可选: wrangler secret put INVITE_CODE
npm run deploy         # 构建并部署 Worker + Pages
```

## API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/health` | 无 | `{ ok, domain, inviteRequired, turnstileRequired }` |
| `POST` | `/api/mailboxes` | 无 + Turnstile | 创建邮箱；可选 `inviteCode`；成功返回 `{ id, localPart, createdAt, token, expiresAt }` |
| `DELETE` | `/api/mailboxes/:id` | Bearer | 删除当前会话所属邮箱（级联邮件与会话） |
| `POST` | `/api/auth/login` | 无 + Turnstile | `{ localPart, password }` → `{ token, expiresAt, mailbox }` |
| `POST` | `/api/auth/logout` | Bearer | 作废当前 token；`?all=1` 作废该邮箱全部会话 |
| `POST` | `/api/mailboxes/:id/login` | 无 | 按 id 登录（内部/兼容） |
| `POST` | `/api/mailboxes/:id/password` | Bearer | 改密；吊销全部会话并返回新 `token` |
| `GET` | `/api/mailboxes/:id/emails` | Bearer | 列表 + `quota` + `total` + `unread` + `matchedTotal`；`?limit&offset&unread=1&q=` |
| `GET` | `/api/mailboxes/:id/emails/:emailId` | Bearer | 详情（含 to/cc/messageId/attachments 元数据），自动标已读 |
| `PATCH` | `/api/mailboxes/:id/emails/:emailId/read` | Bearer | `{ isRead }` 标已读/未读 |
| `POST` | `/api/mailboxes/:id/emails/mark-all-read` | Bearer | 全部标已读 |
| `DELETE` | `/api/mailboxes/:id/emails/:emailId` | Bearer | 删除单封并扣减 `used_bytes` |
| `POST` | `/api/mailboxes/:id/emails/bulk-delete` | Bearer | `{ mode: ids\|oldest\|all, ids?, count? }` |
| `PATCH` | `/api/mailboxes/:id/emails/:emailId` | Bearer | `{ isStarred?, folder?, labels? }` |
| `GET` | `/api/mailboxes/:id/emails/:emailId/eml` | Bearer | 重建 `.eml` 下载 |
| `GET` | `/api/mailboxes/:id/export` | Bearer | `?format=json\|mbox` |
| `GET/POST/DELETE` | `/api/mailboxes/:id/filters` | Bearer | 入站过滤器 |
| `GET` | `/api/admin/stats` | Admin | 需 `ADMIN_TOKEN` |
| `GET/POST/DELETE` | `/api/admin/blocked-prefixes` | Admin | 封禁前缀 |

**已移除**：公开的 `GET /api/mailboxes`（不再公示全站地址列表）。

### 安全与约束（P0）

- **前缀规范化**：小写；**至少 3 个字符**；字母数字与 `._+-`；不能以点开头/结尾；无连续点；首尾须为字母或数字
- **保留前缀（RFC 2142 等）**：`postmaster`、`abuse`、`hostmaster`、`webmaster`、`www`、`noc`、`security`、`info`、`sales`、`support`、`noreply` 等不可注册
- **品牌前缀**：知名平台/品牌名及其分隔片段（如 `google`、`google.support`、`paypal-notify`）不可注册（规则见 `shared/local-part.ts`）
- **限流**（D1 `rate_limits`）：创建默认 3 次/IP/小时；登录默认 30 次/IP/15 分钟、10 次/IP+地址/15 分钟
- **注册上限**：默认最多 500 个邮箱（`MAILBOX_MAX_TOTAL`，`0` 表示不限制）
- **邀请码**：配置 `INVITE_CODE` 后创建必填
- **Turnstile**：配置 `TURNSTILE_SECRET` 后创建/登录必过校验
- **配额**：`mailboxes.used_bytes` 条件更新，降低入站并发超配额
- **会话清理**：每小时 Cron 删除过期 `auth_sessions`；鉴权时惰性删除当前过期 token

### 相关环境变量（`wrangler.jsonc` vars / secrets）

| 名称 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `LEMONMAIL_DOMAIN` | var | `lemonhub.net` | 收信域名 |
| `MAILBOX_QUOTA_MB` | var | `10` | 每邮箱配额 |
| `MAILBOX_MAX_TOTAL` | var | `500` | 全站邮箱上限 |
| `MAILBOX_CREATE_PER_IP_HOUR` | var | `3` | 每 IP 每小时创建上限 |
| `LOGIN_PER_IP_WINDOW` | var | `30` | 每 IP 每 15 分钟登录上限 |
| `LOGIN_PER_ADDR_WINDOW` | var | `10` | 每 IP+前缀每 15 分钟登录上限 |
| `TURNSTILE_SECRET` | secret | — | Turnstile 密钥 |
| `INVITE_CODE` | secret | — | 可选邀请码 |

## 收信链路

MX 记录 → Cloudflare Email Routing（catch-all 规则投递到 `lemon-mail` Worker）→ Worker 校验（≤1MB、邮箱存在、配额充足）→ PostalMime 解析 → 存入 D1 `emails` 表，并原子增加 `used_bytes`。失败路径通过 `setReject` 退回发件人。

Email Routing 规则、MX/DNS 记录在 Cloudflare Dashboard 配置，不归 wrangler.jsonc 管理。

## 待办

见 [docs/TODO.md](./docs/TODO.md)。
