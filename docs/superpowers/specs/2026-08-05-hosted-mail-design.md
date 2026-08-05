# Hosted Mail 设计文档

日期：2026-08-05
状态：已批准

## 背景

Lemon Mail 从「转发地址管理」演进为「托管式收件」：用户不再设置转发目标，所有发往 `@lemonhub.net` 的邮件由本网站接收并存储在数据库中，每个邮箱配额 10MB。

## 需求决策（已确认）

1. **v1 只收信**：不做发送/回复（SMTP 出口留待下一层迭代）。
2. **每个邮箱一个密码**：查看/删除该邮箱邮件需登录（邮箱地址 + 密码）。
3. **单封邮件 ≤1MB，不存附件内容**：超限退回发件人；附件仅记录元数据（名字、大小、类型）——实际 v1 仅记录总大小（size），附件正文不落库。
4. **配额 10MB/邮箱**：按入库邮件原始 MIME 字节数（`size`）求和；配额用满拒绝新邮件并退回。
5. **前端**：地址管理 + 登录 + 收件箱（列表/详情/删除/未读/配额进度条）。
6. **收信通道**：Cloudflare Email Routing catch-all → 现有 `lemon-mail` Worker（新增 email 事件处理器），与 API 共用 D1。

## 架构

```
发件人 ──SMTP──> MX(Cloudflare) ──Email Routing catch-all──> lemon-mail Worker (email 事件)
                                                                │ PostalMime 解析
                                                                │ 校验：邮箱存在？单封≤1MB？配额充足？
                                                                │ 失败 → setReject（发件人收到 NDR）
                                                                ▼
                                                              D1: emails 表
                                                                ▲
浏览器（mail.lemonhub.net）──fetch──> api.lemonhub.net (fetch 事件)
   └─ 地址管理 + 收件箱（Bearer token 认证）
```

- 同一 Worker 双事件入口：`export default { fetch: app.fetch, email: handleEmail }`
- `mailboxes.destination`（转发目标）删除，不再向后兼容
- 配额上限 `MAILBOX_QUOTA_MB`（wrangler vars，默认 10）

## 数据模型（migration 0002_hosted_mail.sql）

```sql
ALTER TABLE mailboxes ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes DROP COLUMN destination;

CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  body_html TEXT,
  size INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX idx_emails_mailbox ON emails(mailbox_id, received_at DESC);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

- 密码：WebCrypto PBKDF2（16B 随机盐、100k 迭代、SHA-256、256bit），hex 存储，不存明文
- 会话：32B 随机 token 存 D1，7 天过期

## 入站处理（email 事件）

```
handleEmail(message, env):
 1. raw = 聚合 message.raw（ReadableStream）→ size = 字节数
 2. size > 1MB → setReject('邮件超过大小限制')
 3. 解析 message.to 取 localPart（domain 不符 → reject）
 4. 查 mailboxes：不存在 → reject('收件地址不存在')
 5. 配额：SELECT COALESCE(SUM(size),0) + size > quota → reject('邮箱配额已满')
 6. PostalMime 解析 → sender/subject/body_text/body_html
 7. INSERT emails（is_read=0，received_at=now）
```

- 所有拒绝路径使用 `message.setReject(reason)`；未知异常抛出（= 退回）
- 不存半封邮件：任一步失败即拒绝，不留残留数据

## API 与认证

| 端点 | 认证 | 说明 |
|---|---|---|
| `GET /api/health` | 无 | 健康检查 |
| `GET /api/mailboxes` | 无 | 地址列表（公开管理页沿用） |
| `POST /api/mailboxes` | 无 | `{localPart, password}`（≥8 位），哈希后入库 |
| `DELETE /api/mailboxes/:id` | 无 | 级联删除邮件与会话（batch） |
| `POST /api/mailboxes/:id/login` | 无 | `{password}` → 校验 → `{token, expiresAt}` |
| `GET /api/mailboxes/:id/emails?limit&offset` | Bearer | 列表 + `quota:{used,limit}` + `total` |
| `GET /api/mailboxes/:id/emails/:emailId` | Bearer | 详情，同时标记已读 |
| `DELETE /api/mailboxes/:id/emails/:emailId` | Bearer | 删除，释放配额 |

- 邮箱级端点统一 Bearer token 中间件：查 `auth_sessions`（未过期），注入 mailboxId
- 校验 `?id` 属于该 mailbox（防止越权）
- 密码比对使用恒定时间比较
- 邮件 ID 用 `crypto.randomUUID()`

## 前端（src/App.vue）

- 单 SFC 保持，视图状态机：`manage` → `login` → `inbox`（可返回）
- 管理页：卡片新增「查看收件箱」入口；创建表单加密码字段（≥8 位）
- 收件箱：配额进度条（used/10MB）、邮件列表（未读圆点/发件人/主题/时间/大小）、详情视图（HTML 优先渲染，DOMPurify 消毒；无 HTML 则纯文本）、删除按钮、登出
- token 存 `sessionStorage`（关标签页失效）
- 文案全部中文（zh-CN）

## 依赖

- 新增 `postal-mime`（入站 MIME 解析，Cloudflare 官方，workerd 兼容）
- 新增 `dompurify`（邮件 HTML 渲染消毒，防 XSS）
- 密码哈希用 WebCrypto，零新增后端依赖

## 部署与验证

- 需要用户在 Dashboard 完成（DNS 写权限被挡，无法用 API）：
  - lemonhub.net 添加 MX 记录 + SPF（`include:_spf.mx.cloudflare.net`）
  - Email Routing 开启，catch-all 投递到 `lemon-mail` Worker
  - 若可行，我会先尝试 Email Routing API（enable + dns + catch-all 规则），失败再移交 Dashboard
- 沙箱限制：本地无法跑 workerd → 全部线上验证
- 验证清单：
  - 创建（含密码）/重复 409/登录成功与密码错误 401
  - 空收件箱列表、配额 0/10MB
  - 真实邮件入站 → 入库、已读标记、删除释放配额
  - 配额满拒绝、超 1MB 拒绝（构造测试）

## 不在范围（下一层迭代）

- 发送/回复邮件（SMTP 出口 + SPF/DKIM）
- 附件正文存储（R2）
- 搜索、多标签、分页 UI 优化
- 邮件域名认证之外的访问控制加固（如管理页加锁）
