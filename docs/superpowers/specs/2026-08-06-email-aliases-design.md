# 随机邮箱别名（Random Email Aliases）设计

> 日期：2026-08-06 · 状态：已批准（用户确认）

## 背景与目标

Lemon Mail 提供 `@lemonhub.net` 托管邮箱，无发送能力，仅入站投递。目标：让用户可以为每个用途创建**系统随机生成的别名地址**（如 `x7k2m9@lemonhub.net`），投递到自己的主邮箱，保护真实地址并便于按站点/用途分类管理。

与浏览器级随机别名服务（Firefox Relay / SimpleLogin）对齐：地址不可自定义，防止抢注与字典碰撞；删除后地址**永久占位**，杜绝重放攻击。

## 需求

1. 登录用户可创建别名：**系统随机生成地址**（不可自定义字符串），用户提供**必填备注**（用途说明，可后续编辑）。
2. 别名不设数量上限。
3. 删除别名 = 软删除，地址**永久占位**：不再收信，也永远不可被注册为邮箱或别名。
4. 别名收信投递到归属邮箱，共享配额、过滤器、webhook、FTS 等全部现有能力。

## 数据模型

新 migration `0007_email_aliases.sql`：

```sql
CREATE TABLE aliases (
  local_part TEXT PRIMARY KEY,          -- 随机串，全小写，如 "x7k2m9"
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT NULL                  -- 非空 = 已停用（永久占位）
);
CREATE INDEX idx_aliases_mailbox ON aliases(mailbox_id);
```

- 主键即地址（全局唯一，含软删除行——占位天然成立）。
- `deleted_at IS NULL` 才参与投递；`local_part` 本身始终占用。

## 随机地址生成

- 长度 8，字符集 `[a-z2-9]`（排除易混淆的 `0 o 1 l i`），空间 32^8 ≈ 1.1e12。
- 生成后查重：`mailboxes`（主邮箱）+ `aliases`（含已删除）+ `blocked_prefixes`（保留前缀），冲突则重试（最多 5 次）。
- 5 次仍冲突（概率可忽略）→ 500 `alias_generation_failed`。
- 统一小写；域名部分由展示层拼接 `@lemonhub.net`。

## 入站投递链（server/worker.ts `handleEmail`）

现有：`parseLocalPart` → 查 `mailboxes WHERE local_part = ?` → 未命中 `reject('收件邮箱不存在。')`。

改为三级：

1. 查 `mailboxes(local_part)` → 命中 → 原逻辑投递。
2. 未命中 → 查 `aliases(local_part, deleted_at IS NULL)` → 命中 → 以 `owner.mailbox_id` 走原投递逻辑（配额原子扣减、过滤器、webhook、FTS 全部复用）。
3. 未命中 → `reject('收件邮箱不存在。')`。

别名邮件在 `emails.to_addrs` 中天然记录别名地址，无需额外字段。

## 防抢注（安全关键）

**创建主邮箱时**（`POST /api/mailboxes` 校验段）在现有 `blocked_prefixes` 检查基础上，增加查 `aliases`（含 `deleted_at` 非空行）冲突 → 409（复用 `prefix_reserved` 或新 code `alias_reserved`）。保证已删除别名的地址永远无法被注册，防止旧地址被接管诱骗。

**创建别名时**查重覆盖 `mailboxes + aliases + blocked_prefixes`（见随机生成）。

## API

全部在 `sessionAuth` 下，`:id` 必须匹配 `c.get('mailboxId')`（`assertMailbox`），跨邮箱 → 403。

| 方法 | 路由 | 请求体 | 响应 |
|---|---|---|---|
| GET | `/api/mailboxes/:id/aliases` | — | `{ aliases: [{ id, localPart, address, note, createdAt, deletedAt }] }`（按 created_at DESC；含已停用，`address` = `localPart@LEMONMAIL_DOMAIN`） |
| POST | `/api/mailboxes/:id/aliases` | `{ note: string }` | 201 `{ id, localPart, address, note, createdAt }` |
| PATCH | `/api/mailboxes/:id/aliases/:aliasId` | `{ note: string }` | 200 `{ ok: true }`（备注必填、长度 ≤ 100；已停用别名不可编辑 → 404） |
| DELETE | `/api/mailboxes/:id/aliases/:aliasId` | — | 200 `{ ok: true }`（软删除：`deleted_at = now`；重复删除 → 404） |

错误码（前端 `errors.*` 映射）：
- `note_required`（400）— 备注缺失/空白
- `alias_not_found`（404）— 不存在/不属于当前邮箱/已停用（编辑时）
- `forbidden`（403）、`unauthorized`（401）沿用

## 前端（src/App.vue 设置面板）

新增"别名管理" section（过滤器下方）：

- **创建**：备注输入框（必填）→ "生成别名"按钮 → 请求成功后显示新地址卡片（等宽字体）+ 一键复制按钮。
- **列表**：每行显示 `address`（等宽、可复制）、`note`（inline 编辑：点击铅笔 → 输入 → 保存）、`createdAt`（`formatFullTime`）、删除按钮（确认提示）。已停用行灰置 + 徽标"已停用"，删除按钮隐藏。
- 打开设置时随 `loadSessions`/`loadFilters` 一起 `loadAliases()`。
- i18n：`src/i18n/locales/{zh-CN,en-US}.ts` 新增 `aliases.*` 键（title/hint/create/note/noteRequired/copy/copied/edit/delete/confirm/disabled/loadFailed/createFailed/updateFailed/deleteFailed/empty）。

## 日志

- `alias.created`（localPart, mailboxId）
- `alias.deleted`（localPart, mailboxId）
- 入站 `email.received` 增加可选字段 `aliasLocalPart`（当通过别名投递时）；`email.rejected` 的 `localPart` 不变。

## 测试

`tests/worker-api.test.ts` 新增 describe 组 + 单元测试：

1. **生成器单元测试**：字符集仅含 `[a-z2-9]`、长度 8；查重冲突时重试（seed 已有 local_part 时返回新地址）。
2. **创建/列表**：POST 201 返回随机地址（匹配 `/^[a-z2-9]{8}@lemonhub\.net$/`）；GET 列表含刚创建的；无鉴权 401。
3. **备注校验**：缺备注 → 400 `note_required`；PATCH 编辑备注 → 200，列表更新；空备注 PATCH → 400。
4. **软删除 + 占位**：DELETE → 200；列表该项 `deletedAt` 非空；再次 DELETE → 404。
5. **防抢注**：删除别名后，同地址 POST `/api/mailboxes` → 409（不可注册为主邮箱）。
6. **跨邮箱**：邮箱 B 的 token 访问邮箱 A 的 aliases → 403。
7. **入站投递**：mock `ForwardableEmailMessage`（`raw`/`rawSize`/`to`/`from`/`setReject`）调用 `worker.email` → 邮件落入 owner 邮箱（`emails` 表新增行，`to_addrs` 含别名地址）；未删除别名正常投递、已删除别名 → `setReject` 被调用。

## 不做的事（明确排除）

- 别名发信（系统无发送能力）。
- 通配符 / `+tag` 子地址别名（本期不做）。
- 别名单独配额或限制；别名审计表。
- 已删除别名的恢复/重新激活。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 随机碰撞 | 8 位 + 32 字符集 + 查重重试（5 次）；碰撞概率 ≈ 0 |
| 重放攻击（删除地址被接管） | 软删除永久占位 + 主邮箱创建时查 aliases 冲突 |
| 大量别名刷 D1 | 创建需登录（已有邮箱 token），无上限按用户决定；如后续滥用再加载创建限流 |
| Email Routing 对随机地址 | 无需改动：catch-all 已将所有地址路由到 worker |
