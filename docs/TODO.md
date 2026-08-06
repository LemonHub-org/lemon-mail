# Lemon Mail 待办清单

> 来源：代码 / schema / 设计文档对照审查；随实现与部署持续更新。  
> 状态约定：`待办` · `进行中` · `完成` · `搁置`

---

## 进度总览

| 优先级 | 完成 | 待办 | 备注 |
|--------|------|------|------|
| **P0 安全底线** | 8 / 8 | 0 | 已实现并部署 |
| **P1 产品完整度** | 13 / 13 | 0 | 已实现 |
| **P2 下一阶段** | 8 / 8 | 0 | 不含发送与 R2 附件；migration `0005_p2_features` |
| **P3 体验与工程** | 8 / 8 | 0 | P3-1~P3-8 全部完成 |
| **P4 反滥用** | 4 / 5 | 1 | 一人一邮箱；创建路径线上验证被 Turnstile 挡，跳过 |

---

## 当前基线（已具备）

- 入站收信 + 显示名 / 收件抄送 / Message-ID / 附件**元数据**
- 登录、登出；Bearer 会话；删除邮箱需鉴权
- 收件箱：三栏 UI、未读/星标/归档/回收站、FTS 搜索、过滤器、导出、.eml
- 前缀规则：RFC + 品牌 + ≥3 字符
- 安全：限流、Turnstile、可选邀请码、配额、Cron 会话 + 可选超龄清理
- 管理员：`ADMIN_TOKEN` → `/api/admin/*`（统计、封禁前缀）
- 可选 webhook：`MAIL_WEBHOOK_URL`
- 线上：`https://mail.lemonhub.net` · API `https://api.lemonhub.net`

明确不在范围 / 暂缓：
- **发送 / 回复 / 转发**
- **附件正文 R2 托管**（仅元数据）
- IMAP/POP

---

## P0 — 安全底线

| ID | 状态 | 项 |
|----|------|-----|
| P0-1 … P0-8 | 完成 | 限流 / 注册约束 / 保留前缀 / 规范化 / 登出 / 会话清理 / 配额 / 文档 |

---

## P1 — 产品完整度

| ID | 状态 | 项 |
|----|------|-----|
| P1-1 … P1-13 | 完成 | 改密、已读、批量、未读 UX、元数据、搜索、自动刷新、确认 UI、域名、favicon 等 |

---

## P2 — 下一阶段能力

| ID | 状态 | 项 | 说明 |
|----|------|-----|------|
| P2-1 | 完成 | 原始邮件导出 | `GET .../emails/:id/eml` 由已存字段重建 RFC822 |
| P2-2 | 完成 | 星标 / 文件夹 / 标签 | `is_starred` / `folder` / `labels_json`；侧栏与 PATCH |
| P2-3 | 完成 | 服务端全文搜索 | FTS5 `emails_fts` + `?q=` |
| P2-4 | 完成 | 过滤器 | `mail_filters` 入站自动删/星/归档/已读/标签 |
| P2-5 | 完成 | 到达通知 | `MAIL_WEBHOOK_URL` POST `email.received`（Push 未做） |
| P2-6 | 完成 | 管理员能力 | `ADMIN_TOKEN`：stats + blocked_prefixes |
| P2-7 | 完成 | 按邮箱导出 | `GET .../export?format=json\|mbox` |
| P2-8 | 完成 | 超龄邮件清理 | `EMAIL_MAX_AGE_DAYS` + 小时 Cron |

---

## P3 — 体验与工程

| ID | 状态 | 项 | 说明 |
|----|------|-----|------|
| P3-1 | 完成 | 多标签页同步 | `storage` 事件：主题/语言/最近邮箱直同步；`lm-event` 广播收件箱变更（防抖静默刷新）、登出、删箱 |
| P3-2 | 完成 | 快捷键扩展 | J/K 导航 · R 刷新 · U 返回 · S 星标 · A 归档 · M 回收站 · X 已读 · 1-5 文件夹 · ⌘/Ctrl+Delete 删除 · ? 帮助面板 |
| P3-3 | 完成 | 深色模式 | 语义色板 + 明暗切换 + 持久化 + 防闪烁 |
| P3-4 | 完成 | PWA | vite-plugin-pwa + Workbox 预缓存 + 字体/验证码运行时缓存 + 安装提示 |
| P3-5 | 完成 | 自动化测试 | vitest + @vue/test-utils + jsdom；`tests/`：local-part/theme/tabs 单元 + `tests/helpers/mini-d1.ts` 内存 D1 驱动的 worker API 测试（创建/反滥用/登录/邮件流/admin），34 例全绿；`npm test` |
| P3-6 | 完成 | 可观测性 | 结构化 JSON 日志（`wrangler tail`）：`api.request` 中间件、`api.error`、创建/拒绝/登录/入站拒绝/丢弃/失败埋点、`cron.run` 计数 |
| P3-7 | 完成 | 入站 reject 不误报 | |
| P3-8 | 完成 | 会话列表 | `GET/POST /api/mailboxes/:id/sessions` + `DELETE .../sessions/:sessionId`（踢出非当前会话）；设置面板展示登录设备 |

---

## P4 — 反滥用（一人一邮箱）

| ID | 状态 | 项 | 说明 |
|----|------|-----|------|
| P4-1 | 完成 | 一人一邮箱硬限制 | migration `0006`：`mailboxes.device_id/creator_ip` + `registrations` 审计表 |
| P4-2 | 完成 | 判定规则 | R1 同设备已有邮箱 → 409 `abuse.device_exists`；R2 无指纹同 IP≥3 → 409 `abuse.ip_limit`；R3 同 IP≥8 → 409 |
| P4-3 | 完成 | 管理员能力 | `GET /api/admin/registrations` + `POST /api/admin/mailboxes/:id/unbind`（解绑设备） |
| P4-4 | 完成 | 前端接入 | `device-id` header（localStorage `lm-device-id`）+ 双语文案 + 创建页"一人一邮箱"提示 |
| P4-5 | 进行中 | 线上验证 | admin API 已验证（401/审计/404）；创建路径因 Turnstile 无法 curl，需真实浏览器或临时测试密钥验证 |

已知边界：无登录态下指纹可清除（清 localStorage + 换 IP 可绕过）；R2 规则提高绕过成本。后续可叠加邀请码 / 外部验证强化。

---

## 已知实现细节备忘

- Migrations：`0001` → `0002` → `0003_p0` → `0004_p1` → `0005_p2` → `0006_anti_abuse`
- 附件仅元数据；.eml 为重建件，非原始 MIME
- FTS 使用 unicode61；失败时 LIKE 回退
- 管理员与 webhook 需配置 secret / env 后生效
- `EMAIL_MAX_AGE_DAYS=0` 表示不自动删信

---

## 建议落地顺序

1. ~~P0~~ · ~~P1~~ · ~~P2~~ → 完成  
2. **P3**（测试、可观测性、会话列表等）

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-05 | P0/P1 完成；发送与 R2 附件暂缓 |
| 2026-08-05 | **P2 八项完成**：migration `0005`、FTS/星标文件夹/过滤/导出/webhook/管理/超龄清理 |
| 2026-08-06 | **P3-3 深色模式完成**；移动端适配、中文字体（Noto Sans SC）、UI/UX 优化完成 |
| 2026-08-06 | **P4 反滥用上线**：migration `0006`、R1/R2/R3 规则、注册审计、admin 解绑；`ADMIN_TOKEN` 已配置 |
| 2026-08-06 | **P3-4 PWA 完成**：manifest + Workbox 预缓存、字体/验证码运行时缓存、iOS meta、安装提示按钮 |
| 2026-08-06 | **P3-1 多标签页同步完成**：`src/tabs.ts` 事件广播；主题/语言/最近邮箱/收件箱变更/登出/删箱跨标签页同步 |
| 2026-08-06 | **P3-2 快捷键扩展完成**：U/S/A/M/X/1-5 新增 + ? 帮助面板 |
| 2026-08-06 | **P3-5 自动化测试完成**：vitest 34 例（单元 + MiniD1 worker API 集成）；`npm test` |
| 2026-08-06 | **P3-6 可观测性完成**：结构化 JSON 日志（api.request/创建/登录/入站/cron 埋点），`wrangler tail` 验证 |
| 2026-08-06 | **P3-8 会话列表完成**：列出活跃会话 + 踢出非当前会话；**P3 全部完成（8/8）** |
