# Lemon Mail

基于 `lemonhub.net` 的托管式域名邮箱：邮件直接接收并存储在本站数据库，每个邮箱 10MB 配额。前端采用 Vue 3、Tailwind CSS 和 TypeScript，后端采用 Hono 和 TypeScript，部署在 Cloudflare（Workers + Pages + D1 + Email Routing）。

- 前端：https://mail.lemonhub.net
- API：https://api.lemonhub.net

## 本地运行

```bash
npm install
npm run dev
```

网页运行在 `http://localhost:5173`，Worker API 运行在 `http://localhost:8787`（本地 D1 状态保存在 `.wrangler/state`）。

## 部署

```bash
npm run db:migrate     # 应用 D1 migration 到远程数据库
npm run deploy         # 构建并部署 Worker + Pages
```

## API

- `GET /api/health`
- `GET /api/mailboxes` / `POST /api/mailboxes` / `DELETE /api/mailboxes/:id`
- `POST /api/mailboxes/:id/login` — 邮箱密码登录，返回会话 token
- `GET /api/mailboxes/:id/emails` — 邮件列表 + 配额（需 Bearer token）
- `GET /api/mailboxes/:id/emails/:emailId` — 邮件详情（自动标记已读）
- `DELETE /api/mailboxes/:id/emails/:emailId` — 删除邮件，释放配额

## 收信链路

MX 记录 → Cloudflare Email Routing（catch-all 规则投递到 `lemon-mail` Worker）→ Worker 校验（≤1MB、邮箱存在、配额充足）→ PostalMime 解析 → 存入 D1 `emails` 表。失败路径通过 `setReject` 退回发件人。

Email Routing 规则、MX/DNS 记录在 Cloudflare Dashboard 配置，不归 wrangler.jsonc 管理。
