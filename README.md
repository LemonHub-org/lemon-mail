# Lemon Mail

基于 `lemonhub.net` 的域名邮箱地址管理界面。前端采用 Vue 3、Tailwind CSS 和 TypeScript，后端采用 Hono 和 TypeScript。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

网页运行在 `http://localhost:5173`，Hono API 运行在 `http://localhost:8787`。

## API

- `GET /api/health`
- `GET /api/mailboxes`
- `POST /api/mailboxes`
- `DELETE /api/mailboxes/:id`

当前邮箱地址保存在内存中，适合做界面和 API 验证。正式环境应改用数据库，并把创建或删除地址同步到邮件转发服务商。

## 开通 @lemonhub.net 真正收信所需事项

这个项目不会自行取得域名或 DNS 的控制权。要让邮箱真实收件，需要在你的 DNS 服务商和邮件转发服务中完成：

1. 选择支持入站邮件的服务，例如 Cloudflare Email Routing。
2. 按服务商要求为 `lemonhub.net` 添加 MX、SPF 和 DKIM 记录。
3. 验证要接收转发邮件的目标收件箱。
4. 将 Hono 的内存存储替换为数据库，并在 `POST` 和 `DELETE` 操作中调用该服务商的 API。

完成这些配置前，页面中创建的地址仅作为本地管理数据，不会实际接收或转发邮件。
