# S3 Image Sync Pro

[![GitHub release](https://img.shields.io/github/v/release/hailanbb/s3-image-sync-pro?display_name=tag&sort=semver)](https://github.com/hailanbb/s3-image-sync-pro/releases/latest)
[![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A5%201.6.6-7C3AED)](https://obsidian.md/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

> 面向 Obsidian 的 S3 / Cloudflare R2 图片上传、本地镜像、路径迁移、安全删除与三方一致性校对插件。

[下载最新版](https://github.com/hailanbb/s3-image-sync-pro/releases/latest) · [提交问题](https://github.com/hailanbb/s3-image-sync-pro/issues) · [架构变更](docs/CHANGES.md) · [English overview](#english-overview)

当前文档对应 **1.7.1**。它以完全没有 S3、R2 使用经验的读者为主要对象；如果你已经熟悉这些概念，可以直接阅读[目录策略](#目录策略四种模式)、[与 Agent 和整理插件配合](#与-agent-和整理插件配合)或[三方一致性校对](#三方一致性校对)。

## 目录

- [一分钟理解插件](#一分钟理解插件)
- [它能做什么，不能做什么](#它能做什么不能做什么)
- [开始前的安全提醒](#开始前的安全提醒)
- [安装、升级与回滚](#安装升级与回滚)
- [Cloudflare R2 从零配置](#cloudflare-r2-从零配置)
- [第一次上传](#第一次上传)
- [输入来源与实际行为](#输入来源与实际行为)
- [目录策略：四种模式](#目录策略四种模式)
- [中文知识库目录示例](#中文知识库目录示例)
- [路径、镜像与链接模式](#路径镜像与链接模式)
- [与 Agent 和整理插件配合](#与-agent-和整理插件配合)
- [启动补处理](#启动补处理)
- [笔记移动与路径迁移](#笔记移动与路径迁移)
- [延迟安全删除](#延迟安全删除)
- [三方一致性校对](#三方一致性校对)
- [左侧“小云朵”菜单](#左侧小云朵菜单)
- [设置项完整说明](#设置项完整说明)
- [常用工作流](#常用工作流)
- [故障排查](#故障排查)
- [隐私与安全](#隐私与安全)
- [当前限制](#当前限制)
- [开发、测试与发布](#开发测试与发布)
- [版本记录与 1.5.5 说明](#版本记录与-155-说明)
- [English overview](#english-overview)

## 一分钟理解插件

插件同时面对三类数据：

1. **笔记引用**：Markdown 笔记中用于显示图片的链接。
2. **本地镜像**：Vault 内保存的图片副本，默认根目录为 `98 cloudflareR2`。
3. **云端对象**：真正保存在 R2 / S3 Bucket 中的图片。

对本插件能够识别并管理的图片，最重要的是下面这个“三方不变量”：

```text
云端对象键
  = 本地镜像根目录下的相对路径
  = 从笔记云端 URL（当前或已登记的历史前缀）解析出的键
    或从笔记本地镜像链接中去掉镜像根目录后得到的键
```

例如笔记为：

```text
06 已归档/教程/示例教程.md
```

上传后可能得到：

```text
云端对象键：06 已归档/教程/示例教程/screenshot-a1b2c3.webp
本地镜像：  98 cloudflareR2/06 已归档/教程/示例教程/screenshot-a1b2c3.webp
云端链接：  https://images.example.com/06%20%E5%B7%B2%E5%BD%92%E6%A1%A3/%E6%95%99%E7%A8%8B/%E7%A4%BA%E4%BE%8B%E6%95%99%E7%A8%8B/screenshot-a1b2c3.webp
```

> `images.example.com` 只是文档示例，并非可用服务地址。

“默认链接模式”只决定**笔记里写云端 URL，还是写本地镜像路径**。无论选择云端还是本地，只要上传成功，插件都会同时建立云端对象和本地镜像。云端链接只有属于当前 URL 前缀或“识别的历史 URL 前缀”时，才会被插件当作自己的对象引用。

## 它能做什么，不能做什么

### 主要功能

- 上传本地图片到 Cloudflare R2、AWS S3、MinIO 或其他 S3 兼容存储。
- 每次成功上传都建立路径完全对应的本地镜像。
- 在云端链接和本地镜像链接之间切换。
- 在云端模式下接管 Obsidian、脚本或其他插件生成的标准本地图片链接。
- 转存网页剪藏中的外部网络图片。
- 在 Obsidian 重启后增量补处理关闭期间的新建或修改笔记。
- `managed` 笔记移动或重命名时，先建立并验证新对象与新镜像，再改写链接。
- 路径迁移旧对象与删除笔记对象分别受独立开关控制，并使用版本化延迟删除。
- 快速或深度比较笔记引用、本地镜像和整个 Bucket 的对象清单。
- 可选 WebP 压缩、粘贴/拖拽自动上传和桌面端定时扫描。
- 可用目录策略明确区分暂存、完整管理、只读校验和完全忽略。

### 支持的常见链接

| 内容 | 支持情况 |
| --- | --- |
| 本地 Wiki 嵌入 `![[图片.png]]` | 支持扫描和上传 |
| 本地 Markdown 图片 `![说明](图片.png)` | 支持扫描和上传 |
| 本地镜像中的 Wiki / Markdown 图片 | 支持按镜像相对路径原样补传 |
| 标准网络图片 `![说明](https://...)` | 支持手动或自动转存 |
| 当前或已登记历史 URL 前缀下的 Markdown 图片 | 支持下载、迁移和校对 |
| HTML `<img>`、Base64 图片 | 当前不支持 |
| Excalidraw 等插件内部数据中的图片 | 当前不保证识别 |
| 需要登录、Cookie、Referer 或特殊防盗链头的图片 | 可能无法转存 |

## 开始前的安全提醒

1. **先备份 Vault。** 最好同时启用 Obsidian Sync、Git 或其他带历史版本的备份。
2. **先用一篇测试笔记。** 确认笔记、镜像和云端三处都正常，再处理正式资料。
3. **两个云端删除开关默认都关闭。** 目前只有 AWS S3 能使用带 ETag 的 `If-Match` 条件删除；R2、MinIO 和自定义服务商不会执行自动物理删除。
4. **“校对”不会自动修复。** 快速和深度校对都是只读操作，结果需要你判断。
5. **公开 Bucket 不适合机密图片。** 知道完整 URL 的人通常可以读取公开对象。
6. **默认路径会暴露目录名和笔记名。** 如果目录或标题包含客户、项目或个人信息，公开 URL 也会包含这些文字。
7. **不要分享 `data.json`。** 它包含 Access Key 和 Secret Access Key。

## 安装、升级与回滚

### 手动安装

1. 打开 [Latest Release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest)。
2. 下载 `main.js`、`manifest.json` 和 `styles.css`。
3. 在 Vault 中创建目录：

   ```text
   <你的 Vault>/.obsidian/plugins/s-three-image-sync-pro/
   ```

4. 将三个文件放入该目录：

   ```text
   s-three-image-sync-pro/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

5. 重启 Obsidian，进入“设置 → 第三方插件”，启用 **S3 Image Sync Pro**。

`.obsidian` 通常是隐藏目录。如果看不到，请先在系统文件管理器中显示隐藏文件。

### 从旧版本升级到 1.7.1

1. 停用插件或关闭 Obsidian。
2. 安全备份插件目录中的 `data.json`。它含凭据，不要上传到网盘公开链接或 GitHub。
3. 用 Release 中的三个文件覆盖旧文件，**不要删除 `data.json`**。
4. 启动 Obsidian，确认插件版本是 `1.7.1`。
5. 打开设置检查目录范围：旧用户仍保留“旧版排除目录”模式，不会被自动改成目录策略。
6. 第一次启用“目录策略”时先配置规则，再运行快速校对。
7. 检查两个删除开关和“待延迟删除”数量，再用测试笔记分别验证路径迁移与笔记删除的宽限流程。

1.7.0 会读取旧设置；新增的索引、拥有对象记录、启动补处理队列和删除队列保存在原 `data.json` 中。全新且没有基线时，旧版排除目录模式只建立基线；目录策略模式会把 `staging` / `managed` 既有笔记加入顺序补处理队列。升级后请先核对目录规则和默认链接模式，再让队列运行。

### 回滚

如果新版本不符合预期：

1. 先关闭“删除笔记时同步删除云端图片”和“路径迁移后清理旧对象”，再停用插件。
2. 关闭 Obsidian。
3. 恢复升级前备份的 `main.js`、`manifest.json`、`styles.css` 和 `data.json`。
4. 重新启动并检查一篇测试笔记。

只替换代码而继续使用新版 `data.json`，可能保留新版索引或待删除队列；完整回滚应同时恢复升级前的设置备份。

## Cloudflare R2 从零配置

Cloudflare R2 是推荐服务商。下面只介绍插件使用所需的最小配置。

### 第 1 步：创建 Bucket

1. 登录 Cloudflare 控制台。
2. 打开 **R2 Object Storage**。
3. 创建一个专门用于 Obsidian 图片的 Bucket，例如 `obsidian-images`。
4. 记住 Bucket 名称。

建议使用专用 Bucket。当前一致性校对会列出整个 Bucket；如果同一个 Bucket 还存放网站资源或其他程序文件，它们会显示为“未被笔记引用”。

### 第 2 步：创建最小权限凭据

1. 在 R2 中打开 **Manage API Tokens**。
2. 创建只允许访问目标 Bucket 的 Token。
3. 至少授予 **Object Read & Write** 权限。
4. 保存 Access Key ID 和 Secret Access Key。

Secret 通常只显示一次。不要把它放进截图、README、Issue 或聊天记录。官方说明见 [R2 API tokens](https://developers.cloudflare.com/r2/api/s3/tokens/)。

### 第 3 步：填写 Endpoint

普通 R2 Endpoint 通常是：

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

请从 Cloudflare 控制台复制自己的地址。Endpoint 用于带签名的上传、下载、列举、查询和删除，不是笔记显示图片时使用的公开域名。即使 Bucket 是私有的，只要凭据有读取权限，“一键下载云端图片至本地镜像”也可以通过这个 Endpoint 工作。

### 第 4 步：设置公开访问 URL

R2 Bucket 默认不公开。你可以：

- 绑定自定义域名，适合长期使用；或
- 临时启用 `r2.dev` 开发地址，仅用于测试。

官方说明见 [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)。配置后，用浏览器无痕窗口打开一个完整图片 URL，确认不登录也能读取。这里验证的是**云端模式下 Markdown 能否显示图片**；它不是带签名镜像下载的必要条件。

### 第 5 步：填写插件设置

| 插件字段 | R2 填写内容 |
| --- | --- |
| 存储服务商 | `Cloudflare R2（推荐）` |
| 端点 URL | R2 S3 API Endpoint |
| 存储桶名称 | 刚创建的 Bucket 名称 |
| Access Key ID | Token 生成的 Access Key ID |
| Secret Access Key | Token 生成的 Secret Access Key |
| 公开访问 URL | 自定义域名或 `r2.dev` 地址 |
| 上传路径模板 | 建议保留 `{notedir}/{notename}/{filename}-{hash-short}.{ext}` |

点击“测试连接”。这个测试只验证插件能否使用凭据读取 Bucket；它**不等于**已经验证：

- 公开访问 URL 可以显示图片；
- 上传和删除权限一定正确；
- Vault 内可以写入镜像。

因此仍需完成下一节的一张图片测试。

### 其他 S3 服务商

| 服务商 | Endpoint / Region 注意事项 | 公开访问 URL |
| --- | --- | --- |
| AWS S3 | Endpoint 和 Region 必须与 Bucket 所在区域一致 | 公开 Bucket、CDN 或自定义域名 |
| MinIO | 填写 MinIO API 地址及部署使用的 Region | 可公开读取对象的网关或域名 |
| 自定义 S3 | 按服务商的 S3 兼容说明填写 | 能直接读取图片的 URL 前缀 |

## 第一次上传

建议第一次使用时保持以下安全设置：

```text
本地镜像目录：98 cloudflareR2
默认链接模式：本地
上传路径模板：{notedir}/{notename}/{filename}-{hash-short}.{ext}
上传后将原附件移入回收站：关闭
路径迁移后清理旧对象：开启（如需零云端删除，可在测试时关闭）
删除笔记时同步删除云端图片：关闭
```

然后：

1. 创建 `测试/S3 图片测试.md`。
2. 插入一张不重要的本地图片。
3. 点击左侧小云朵 → “扫描当前文档图片”。
4. 在候选窗口中选择图片并确认上传。
5. 验证三处：
   - 笔记中的图片可以显示；
   - Bucket 中出现对应对象；
   - `98 cloudflareR2/` 中出现相同对象键的镜像。
6. 运行“快速校对笔记、本地镜像与云端”，确认没有缺失或大小异常。

默认不会移除原附件。如果确定原附件没有被其他笔记共享，可以另行开启“上传后将原附件移入回收站”。

## 输入来源与实际行为

这是理解自动处理最重要的一张表。

### 表 1：输入来源 × 插件行为

| 图片或笔记是怎样产生的 | 必要条件 | 1.7.0 的实际行为 |
| --- | --- | --- |
| 在 Markdown 编辑器中粘贴或拖入图片 | 开启“粘贴/拖拽图片自动上传”，当前笔记已经保存为 `TFile`，且属于 `staging` 或 `managed` | 立即上传、写镜像，并插入默认模式的链接；无已保存笔记或目录不可写时不接管 Obsidian 默认行为 |
| Obsidian 打开时，Agent / 其他插件写入普通本地图片链接 | 笔记属于 `staging` 或 `managed`，默认链接模式为“云端” | 笔记稳定约 5 秒后，上传镜像目录内或目录外的受支持图片；保留原附件，改成云端链接 |
| Agent / 其他插件写入网络图片 | 开启“自动转存网络图片”，笔记属于 `staging` 或 `managed` | 稳定约 5 秒后下载、上传、写镜像并替换链接 |
| Agent 直接把图片写入本地镜像并插入链接 | 默认链接模式为“云端”，笔记属于 `staging` 或 `managed` | 以镜像根之后的相对路径作为对象键原样上传，不再次加哈希或压缩 |
| 图片已经是当前或已登记历史 URL 前缀的云端链接 | 无 | 不重复转存；可按目录模式参加签名下载、路径迁移和校对，迁移后写入当前 URL 前缀 |
| Obsidian 关闭期间产生或修改笔记 | 开启“补处理关闭期间的变化” | 有基线时只补处理新建或变更笔记；无基线且使用目录策略时，顺序补处理全部 `staging` / `managed` 既有笔记；旧版范围模式只建立基线 |
| 默认链接模式为“本地”，且没有开启网络转存 | 无粘贴拦截或定时扫描 | 普通后台 create/modify 不会自动上传本地附件；使用粘贴上传、手动扫描或定时扫描 |
| HTML、Base64、特殊插件内部格式 | 无 | 当前不保证识别或处理 |
| 笔记处于 `verify` 或 `ignore` | 无 | 不上传、不下载、不改链接；`verify`参加只读校对并报告路径差异，`ignore`引用只用于防止把对象误判为孤儿或误删 |

“本地图片”只有在标准 Wiki / Markdown 链接能够解析到 Vault 内实际文件时才能上传。只写了一个不存在的路径，插件无法凭空恢复图片。

## 目录策略：四种模式

设置中的“目录处理范围”有两种体系：

- **旧版排除目录**：为兼容旧用户保留。排除列表中的目录完全不处理，其余目录按完整管理处理。
- **目录策略（推荐）**：每个目录明确指定一种模式；未匹配目录默认忽略。

规则格式为每行一条：

```text
staging: 01 Inbox
managed: 06 Archive
verify: 04 Wiki
ignore: 03 Backup
```

路径是 Vault 相对路径，不要填写盘符。最长匹配规则优先，因此可以先管理大目录，再忽略其中的敏感子目录。相同路径发生冲突时按更保守的模式处理：`ignore` > `verify` > `managed` > `staging`。

### 表 2：目录模式 × 允许动作

| 模式 | 适合用途 | 上传/下载与改链接 | 规范路径检查 | 路径迁移 | 一致性校对 | 删除生命周期 |
| --- | --- | --- | --- | --- | --- | --- |
| `staging` | 收件箱、会继续整理的暂存区 | 允许 | 不报告 | 不迁移 | 参加存在性、大小等校对 | 可进入延迟队列 |
| `managed` | 路径已经定稿的正式资料、工作目录 | 允许 | 报告 | 允许 | 完整参加 | 可进入延迟队列 |
| `verify` | 只读资料、只希望发现问题的目录 | 不允许 | 报告 | 不迁移 | 只读参加 | 不触发 |
| `ignore` | 备份、源码、完全交给其他工具的笔记 | 不允许 | 不报告 | 不迁移 | 不列普通问题；引用作为保护 | 不触发 |

`staging` 与 `managed` 都能接收、上传、下载和切换链接，但职责不同：`staging` 是“先把内容安全接住”，不会因为暂存目录或临时标题而迁移云端对象；`managed` 才维护由笔记目录和笔记名决定的规范路径。这样把笔记从 `01 待阅收件箱` 整理进正式目录后，目标路径才会定稿。

另外，“不参与路径同步的云端键前缀”是另一层保护：例如默认的 `mpclipper`。命中该前缀的对象不会被本插件迁移或自动删除，但仍可能出现在只读校对结果中。

## 中文知识库目录示例

以下是适合“收件箱 → 整理 → 归档/工作”的示例，不会由插件自动写入，需要你在设置中自行粘贴：

```text
staging: 01 待阅收件箱
ignore: 03 已整理
verify: 04 wiki
managed: 06 已归档
managed: 07 康果科技
verify: 08 AI agent
ignore: obsdian
ignore: 98 cloudflareR2
```

建议理解：

- `01 待阅收件箱`：允许接管 Agent、剪藏插件产生的新图片，使用 `staging`。
- `03 已整理`：作为原件备份时通常不希望改写，使用 `ignore`。
- `04 wiki`：如果主要由 AI 维护且当前只需检查图片，使用 `verify`。
- `06 已归档`：如果进入归档时需要把云端路径定稿，使用 `managed`；如果归档后绝不允许任何 Markdown 改写，则改为 `verify`，并在进入前完成迁移。
- `07 康果科技`：需要正常图片同步可用 `managed`，但业务截图应先确认是否适合公开 Bucket。
- `08 AI agent`：只读资料可用 `verify`；确实需要自动上传时改成 `managed`。
- `obsdian`：插件源码和开发文件使用 `ignore`。
- `98 cloudflareR2`：这是镜像输出目录，不是笔记处理目录。

重要区别：`ignore` 笔记不会生成普通校对问题，但其中能识别出的当前/历史云端 URL 和本地镜像链接会作为**保护引用**。因此，只被 `ignore` 笔记引用的对象不会被列为孤儿，也不会在延迟删除复核时被误删。

## 路径、镜像与链接模式

### 默认路径模板

```text
{notedir}/{notename}/{filename}-{hash-short}.{ext}
```

| 变量 | 含义 |
| --- | --- |
| `{notedir}` | 笔记所在目录 |
| `{notename}` | 不含 `.md` 的笔记名 |
| `{filename}` | 不含扩展名的原图片名 |
| `{ext}` | 实际上传格式；启用 WebP 后可能是 `webp` |
| `{hash}` | 实际上传字节的完整 SHA-256 |
| `{hash-short}` | SHA-256 前 32 个字符 |
| `{hash2}` | SHA-256 前 2 个字符 |
| `{yyyy}` / `{MM}` / `{dd}` | 上传当天的年、月、日 |

路径移动、启动路径检查和全量重同步只支持严格的三段模板：

```text
{notedir}/{notename}/<文件名段>
```

其中第三段必须同时包含 `{filename}` 与 `{ext}`。默认模板符合要求；第三段内可以继续组合哈希或日期，例如 `{filename}-{yyyy}.{ext}`。Windows 反斜杠以及首尾斜杠会先被规范化。

以下模板虽然仍可上传，但路径检查和迁移会安全跳过：

```text
{notedir}/{notename}/assets/{filename}.{ext}
{notedir}/{notename}/{yyyy}/{filename}.{ext}
{notedir}/{notename}/fixed.webp
attachments/{yyyy}/{MM}/{hash}.{ext}
```

原因是插件不能从四层以上、固定文件名或纯日期/哈希结构中可靠判断“哪一部分应随笔记移动”。

### 当前与历史云端 URL 前缀

插件写入新云端链接时始终使用当前“公开访问 URL”。如果以后更换 CDN 域名或 `r2.dev` 地址，可在“识别的历史 URL 前缀”中保留旧前缀；每行一个。内部最多保留最近 100 条记录，且每条都会绑定当时的存储身份。修改 Endpoint、Bucket 名或公开访问 URL 时，设置页会自动记住修改前的有效前缀。

历史前缀让同一存储身份下的旧链接仍能被下载、切换、校对和迁移；路径迁移会把它们改写成当前前缀。存储身份由服务商、Endpoint、Bucket、镜像根和 Access Key 指纹共同确定，设置页只显示当前身份所属的历史前缀。切换 Bucket 或其他身份字段后，旧前缀不会被拿到新存储中解析、迁移或删除；切回原身份后仍可继续使用。

请只登记**指向当前同一 Bucket、同一对象键空间的旧别名**，不要把另一个存储库的域名当作历史前缀。建议在旧链接全部转换或移除、待删除队列也为空后，再删除对应历史前缀。

### 云端模式与本地模式

| 项目 | 云端模式 | 本地模式 |
| --- | --- | --- |
| 笔记写入 | 公开 URL | Vault 内镜像路径 |
| 上传云端对象 | 是 | 是 |
| 写入本地镜像 | 是 | 是 |
| 无网络显示 | 通常不行 | 可以 |
| 分享 Markdown | 对方可访问公开 URL | 对方通常没有你的 Vault |
| 后台接管普通本地图片 | 是，约 5 秒后 | 不由普通 create/modify 自动触发 |

切换“仅当前笔记”不会改变全局默认链接模式；选择“全库所有笔记”完成后，才会把默认模式更新为目标模式。

### 每次上传怎样避免同名覆盖

插件先对**最终上传字节**计算 SHA-256；启用 WebP 时，哈希对应压缩后的文件。随后它用带签名 GET 检查目标键：内容相同可以复用，内容不同则按冲突失败。目标不存在时使用仅创建写入，再回读校验正文哈希和本次写入标记；只有能确认是本次插件写入的版本，才登记为可参与后续自动清理的“拥有对象”。

云端确认后，插件才写本地镜像并回读校验哈希，最后由调用流程改写 Markdown。若上传响应丢失或结果不明确，插件不会用一个只知道键名的 DELETE 做“立即回滚”；可能留下的可恢复孤儿由只读校对显示，交给用户判断。

## 与 Agent 和整理插件配合

外部 Agent、剪藏插件和“整理知识库”工作流可能产生不同文件事件，不能简单看作同一种“移动”。

### Agent 生成图文笔记

- **Obsidian 正在运行**：Vault 发出新建或修改事件。云端模式下，插件等待笔记稳定约 5 秒，再处理受支持的本地图片；网络图片还需要开启“自动转存网络图片”。
- **Obsidian 已关闭**：插件看不到即时事件。下次启动时，持久化索引会识别新建或变更笔记，并加入同一后台流程。
- **首次且没有旧基线**：目录策略模式会把全部 `staging` / `managed` 既有笔记加入顺序队列；旧版排除目录模式只建立基线。失败项不会从持久队列消失，会在下次启动继续尝试。

### 整理工作流不一定是直接移动

一个整理工具可能执行：

```text
在 06 已归档 创建加工后的新笔记
把 01 待阅收件箱 的原件移动到 03 已整理
```

这与 `01/原笔记.md → 06/原笔记.md` 的直接重命名不同：

- 新加工笔记会按“新建/修改”处理；
- 原件进入 `03 已整理` 后，如果该目录是 `ignore`，插件不会改写它；
- 延迟删除的全库复核仍会看到 `03` 原件中的旧引用，因此旧云端对象可能被安全保留；
- 校对功能不会自动删除这些旧对象。

如果目标是让 `06` 使用自己的正式对象路径，需把 `06` 设为 `managed`。直接移动单个笔记到 `06` 时会触发迁移；整理工具若采用“新建一份 + 删除/移动原件”，新笔记会先按新建/修改流程接管图片，已有旧云端引用则可在整理后手动运行“重新同步全部 S3 图片路径”。如果 `06` 是 `verify`，插件只报告问题，不改写归档笔记。

## 启动补处理

“补处理 Obsidian 关闭期间的变化”默认开启。它维护每篇 Markdown 的修改时间、大小和受管对象键索引。

启动时：

1. 等待 Obsidian 布局加载完成；
2. 比较当前笔记与上次索引；
3. 只把新建或发生变化的 `staging` / `managed` 笔记加入后台队列；
4. 识别关闭期间消失的 `staging` / `managed` 笔记，并在“删除笔记时同步删除云端图片”开启时加入宽限队列；
5. 重新建立本次索引。

它不是每次启动全量重传。需要注意：

- 无旧基线时，目录策略会顺序补处理既有 `staging` / `managed` 笔记；旧版排除目录模式只建立基线；
- 每篇成功后才从持久队列移除，失败项保留到下次启动，不会因本次 Notice 结束而丢失；
- 云端模式可补处理本地图片；
- 本地模式且未开启网络转存时，普通后台事件不会自动上传本地图片；
- `verify` 和 `ignore` 不会被补写；启动路径检查会分别提示 `managed` 可修复问题和 `verify` 只读问题，`staging` 不做规范路径检查；
- 插件总开关关闭期间不会补做删除。

## 笔记移动与路径迁移

保持“移动笔记时同步 S3 图片路径”为开启、目标笔记属于 `managed`，并使用严格三段模板时，迁移采用“先准备、后改链接”的事务式顺序：

1. 固定本次操作的存储配置、镜像根、模板、源/目标笔记路径，并锁定涉及的对象键；
2. 计算目标对象键，通过带签名 GET 读取源对象并计算最终字节的 SHA-256；源对象不存在时才尝试使用旧镜像恢复；如果两者都不存在，即使目标键恰好已有对象，也拒绝自动改链接；
3. 目标键不存在时使用仅创建写入；若目标已存在，只在内容哈希完全相同的情况下复用，内容不同则按冲突失败，绝不覆盖；
4. 建立目标本地镜像，并重新读取确认 SHA-256 与目标云端字节一致；
5. 再次确认笔记仍在目标路径、目录仍为 `managed`、存储和模板设置没有改变；
6. 最后才改写 Markdown。历史 URL 会统一写成当前 URL，本地模式仍保持本地链接；
7. 如果“路径迁移后清理旧对象”开启，旧对象的**精确版本**进入独立宽限队列。

任何一步失败都会停止后续链接改写；不会为了“修好路径”去覆盖同名但内容不同的新对象。

### 表 3：生命周期事件 × 结果

| 事件 | 插件识别 | 云端和镜像结果 | 旧对象处理 |
| --- | --- | --- | --- |
| Obsidian 内直接移动/重命名一篇笔记，目标为 `managed` | `TFile rename` | 立即执行上述迁移；从 `staging` 移入 `managed` 也会定稿路径 | “路径迁移后清理旧对象”开启时进入宽限队列 |
| 在 `staging` 内移动/改名，或目标为 `staging` / `verify` / `ignore` | `TFile rename` | 不做规范路径迁移 | 原对象保持 |
| 移动或重命名整个文件夹 | `TFolder rename` | 先重建索引；开关开启时，把文件夹内 `managed` 笔记加入队列并逐篇顺序迁移，最后再检查完整性 | 每篇迁移成功后，旧对象按独立清理开关进入宽限队列；失败项保留到下次启动 |
| Agent 在 Obsidian 打开时新建/修改 | `create` / `modify` | 稳定约 5 秒后按目录策略和链接模式处理 | 不涉及旧对象，除非随后发现路径不规范 |
| Agent 在 Obsidian 关闭时新建/修改 | 启动索引差异 | 下次启动增量补处理 | 同上 |
| 外部工具把移动表现为“删除旧文件 + 新建新文件” | 删除队列 + 新建补处理 | 新文件先有机会上传和迁移 | 宽限到期前全库复核，避免立即误删 |
| 用户手动删除 `staging` / `managed` 笔记 | `delete` | 不立即删除云端 | 仅在“删除笔记时同步删除云端图片”开启且通过版本化安全检查后删除 |
| 用户手动删除包含笔记的整个文件夹 | `TFolder delete` | 对启动索引中属于该文件夹的笔记逐篇执行同一删除流程 | 只把已索引且符合条件的精确对象版本加入队列，不按文件夹前缀递归删除 |
| 只从笔记中删除图片链接 | `modify` | 不触发笔记删除流程 | 对象保留，可在校对中显示为未引用 |
| 移动到 `verify` 或 `ignore` | 目标不可写 | 不做路径迁移 | 原对象保持 |

“重新同步全部 S3 图片路径”只处理 `managed` 笔记，并使用相同的安全迁移流程；它不处理 `staging`，也不要求先把链接切成云端。受保护前缀、非规范模板、无法确认源对象和镜像的条目会跳过或计入失败。

## 延迟安全删除

1.7.0 把两种清理目的拆成了独立开关：

| 开关 | 默认值 | 何时进入队列 |
| --- | --- | --- |
| 路径迁移后清理旧对象 | 关闭 | `managed` 笔记已经成功建立新对象、新镜像并改写链接后 |
| 删除笔记时同步删除云端图片 | 关闭 | `staging` / `managed` 笔记真的被删除，或启动索引确认它在关闭期间消失后 |

两个开关共用删除宽限期（默认 10 分钟）与空镜像目录清理设置，但彼此不互相替代。它们只在服务商选择 **AWS S3** 时可开启；选择 R2、MinIO 或自定义服务时，界面会禁用开关，已有任务也只会记录“因服务商不支持安全条件删除而保留”。

### “版本化删除”是什么意思

删除授权不只记住对象键，还绑定了：存储服务商、Endpoint、Bucket、镜像根、Access Key 指纹，以及插件上传时记录的**上传操作 ID、ETag、内容 SHA-256 和字节数**。可以把它理解为“只批准当时那一份精确文件”，而不是“以后凡是这个名字都能删”。四项中任意一项缺失或变化，插件都会保留对象。

1.7 之前的旧记录、第三方对象、只复用了但没有可靠版本记录的对象，以及无法确认四重版本信息的对象，都会保留，不会为了清空队列而冒险删除。

### 工作方式

1. 触发生命周期事件时，只把可确认版本的对象键、原因、存储身份和到期时间写入持久队列，不立即删除。
2. 同一路径恢复或重建笔记会取消尚未执行的“笔记删除/启动缺失”任务；路径迁移任务保持独立，但只要旧对象重新被任何笔记引用，后续复核仍会保留它。
3. 到期时重新读取整个 Vault 的所有 Markdown，包括 `staging`、`managed`、`verify` 和 `ignore`，并同时识别当前与历史 URL 前缀以及本地镜像链接。
4. 任何引用、受保护键前缀、扫描不完整、设置或目录权限变化、存储身份变化，都会让删除停止、保留或延期。
5. 插件通过带签名 GET 读取远端正文，确认操作 ID、ETag、SHA-256 与大小仍等于队列中的精确版本。
6. 删除前先把这一精确版本写入本地镜像，并重新读取校验哈希，确保存在可验证的恢复副本。
7. 仅 AWS S3 会发出带已签名 `If-Match: <ETag>` 的条件 DELETE；并先持久化“正在删除”标记。若对象版本已变化，S3 会拒绝删除；网络结果不明确时，下次运行先用签名 GET 对账，不盲目重试。
8. 删除后再次检查远端和 Vault 引用；若操作期间出现新引用、权限失效或扫描不完整，插件会从已验证镜像恢复原精确版本。
9. 只有确认精确云端对象已删除后，才把同键镜像移入 Obsidian 回收站；可选地清理镜像根以内的空父目录。
10. 失败任务按退避策略重试，最长间隔 60 分钟。

左侧云朵中的“处理延迟删除图片”只处理**已经到期**的任务，不会绕过宽限期。

### “目录”究竟会不会删除

S3 / R2 没有真实目录，控制台中看到的目录只是对象键前缀。最后一个对象删除后，云端界面的虚拟目录自然消失。插件不会按前缀递归删除未知对象。

本地镜像使用真实文件夹；插件只删除精确镜像文件，并可清理一路向上的空目录，但绝不会删除镜像根目录本身。

### 仍应保留云端版本或备份

插件不再对所有“S3 兼容”服务笼统执行普通 DELETE。AWS S3 使用官方 `If-Match` 条件删除；Cloudflare R2 当前兼容性文档没有明确保证 `DeleteObject` 的同等条件语义，因此 R2 自动物理删除被禁用。MinIO 与自定义服务也按未知能力保守处理。

即使使用 AWS S3，共用 Bucket 时仍应为其他程序设置受保护键前缀，并为重要 Bucket 开启服务端版本控制或独立备份。R2 上的旧路径对象可通过只读校对列出，再由你在确认报告后手动清理；插件不会把“未引用”直接当成删除授权。安全队列同样无法识别 HTML、Base64、Excalidraw 内部数据等不支持的引用。

## 三方一致性校对

1.7.0 提供只读的三方校对：

```text
受审核笔记的期望对象键
        ↙          ↘
本地镜像清单       云端 Bucket 清单
```

### 快速校对

“快速校对笔记、本地镜像与云端”会：

- 扫描 `staging`、`managed` 和 `verify` 笔记中的受管引用，同时把 `ignore` 笔记中的可识别引用作为保护引用；
- 读取镜像根目录中的全部文件路径和大小；
- 使用分页的 ListObjectsV2 读取整个 Bucket 的对象键、大小和 ETag；
- 比较存在性和大小；规范路径差异只对 `managed` 与 `verify` 报告，`staging` 不报告临时路径差异；
- 将无法比较内容哈希的对象标为“文件存在但尚未深度验证”。

它不会下载图片、改笔记、上传、覆盖或删除任何对象。“快速”表示不计算所有内容哈希，并不表示大 Bucket 一定瞬间完成。

### 深度校对

命令面板中的“深度一致性校对（SHA-256）”还会：

- 只计算被受审核笔记引用的本地镜像文件 SHA-256，不会给镜像根中的所有孤立文件逐一算哈希；
- 对笔记实际引用的云端对象执行 HEAD；
- 读取由 1.7.0 上传时保存的 `content-sha256` 元数据；
- 在本地和云端都有可比 SHA-256 时报告一致或哈希不一致。

旧版上传或第三方上传的对象可能没有该元数据。深度校对不会为此下载整个云端文件，而是把它标为“尚未深度验证”。

### 表 4：校对异常 × 建议动作

| 结果 | 意义 | 建议动作 |
| --- | --- | --- |
| 路径不一致 | `managed` / `verify` 引用的对象键不符合当前笔记目录/名称 | `managed` 先备份，再运行“重新同步全部 S3 图片路径”；`verify` 只报告，需人工决定 |
| 缺少本地镜像 | 笔记引用云端对象，但镜像中没有 | 运行“一键下载云端图片至本地镜像” |
| 缺少云端对象 | 笔记有链接，但 Bucket 中不存在 | 若本地镜像存在，可扫描当前笔记或运行路径重同步尝试恢复；先不要只改 URL |
| 文件大小不一致 | 相同对象键的本地和云端大小不同 | 决定哪一份是正确来源，再选择重新上传或重新下载 |
| 内容哈希不一致 | 两边都有 SHA-256，但内容不同 | 不自动覆盖；人工选择正确版本 |
| 本地未引用对象 | 镜像文件没有被审核引用或 `ignore` 保护引用命中 | 可能由特殊语法、外部程序或备份使用；不要直接删除 |
| 云端未引用对象 | Bucket 对象没有被审核引用或 `ignore` 保护引用命中 | 可能是旧路径、其他程序文件或备份；校对不会删除 |
| 受保护的外部对象 | 对象命中 `mpclipper` 等前缀 | 交给对应工具管理，本插件不迁移或自动删除 |
| 文件存在但尚未深度验证 | 大小无异常，但没有可比 SHA-256 | 常见于旧对象，不等于损坏 |
| 已验证一致 | 路径、大小及可比哈希一致 | 无需处理 |

窗口最多显示 500 条非正常结果，但顶部计数包含完整结果。当前校对只报告，不提供批量修复或孤儿删除按钮。

### 图片越来越多时怎样保持速度

- 日常依靠笔记增量索引和 create/modify/rename 事件，不反复上传全库。
- 每周或重大整理后运行快速校对。
- 每月或怀疑内容损坏时运行深度校对。
- 使用专用 Bucket，避免把大量无关对象都列为孤儿。
- 为其他工具的对象设置受保护前缀。
- 大库深度校对会对受引用的本地镜像计算哈希，并对受引用云端对象逐个 HEAD，应预留时间；未被引用的镜像不会额外计算哈希。

## 左侧“小云朵”菜单

点击 Obsidian 左侧栏的小云朵，会看到 **7 项**：

| 菜单项 | 范围 | 改笔记 | 改云端 | 改本地 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 扫描当前文档图片 | 当前 `staging` / `managed` Markdown | 是 | 是 | 是 | 网络图片会直接转存；本地候选先显示选择窗口 |
| 扫描全库图片但不替换 | `staging` / `managed` | 否 | 否 | 否 | 按定时扫描的附件根、类型和大小规则做候选预览 |
| 切换图片链接（本地 ↔ 云端） | 当前或全库 `staging` / `managed` | 是 | 切到云端时会先确保镜像已上传 | 不删除 | 切到本地只改已有精确镜像的链接；识别历史 URL |
| 一键下载云端图片至本地镜像 | `staging` / `managed` 引用 | 否 | 带签名 GET，只读 | 是 | 按内容 SHA-256 比较；完全相同才跳过，不同则覆盖并回读校验 |
| 重新同步全部 S3 图片路径 | 仅 `managed` | 是 | 是 | 是 | 使用安全迁移流程；旧对象由独立迁移清理开关控制 |
| 快速校对笔记、本地镜像与云端 | `staging` / `managed` / `verify`、`ignore` 保护引用、镜像根、整个 Bucket | 否 | 只读 | 只读 | 比较路径、存在性和大小 |
| 处理延迟删除图片 | 已到期任务 | 否 | 可能删除 | 可能移入回收站 | 不绕过宽限期；删除前重新扫描全库引用 |

“深度一致性校对（SHA-256）”可从 Obsidian 命令面板运行，但不在小云朵菜单中。

“一键下载”会从当前/历史 URL 或本地镜像链接解析对象键，再通过配置凭据向 S3 Endpoint 发起带签名 GET，因此不依赖图片公开域名。若对象带有插件写入的 `content-sha256` 元数据，还会先验证下载正文；保存后再回读镜像校验。仅文件大小相同不会被当作“已经一致”。

### 扫描当前文档的两个细节

- 本地候选会显示选择窗口；默认选择全部，可以取消。
- 网络图片候选不会进入该本地选择窗口，而是先尝试转存。
- “上传后将原附件移入回收站”默认关闭；镜像文件本身永远不会被当作原附件移除。

## 设置项完整说明

### 云存储连接

| 设置项 | 默认值 | 作用与注意事项 |
| --- | --- | --- |
| 存储服务商 | Cloudflare R2 | 可选 R2、AWS S3、MinIO、自定义 S3 |
| 区域 | R2 为 `auto` | 其他服务商必须与 Bucket 配置一致 |
| 端点 URL | 空 | S3 API 地址，供带签名上传、下载、查询、列举和删除使用，不是公开图片域名 |
| 存储桶名称 | 空 | 建议使用专用 Bucket |
| Access Key ID | 空 | 存在本地 `data.json` 中 |
| Secret Access Key | 空 | 设置页仅遮挡显示，文件中不是加密保险箱 |
| 公开访问 URL | 空 | 新写入笔记的云端链接前缀；云端模式显示图片时需浏览器可读取 |
| 识别的历史 URL 前缀 | 空 | 每行一个；内部最多保留 100 条且按存储身份隔离，识别同一存储的旧域名链接，新链接仍使用当前前缀 |
| 上传路径模板 | `{notedir}/{notename}/{filename}-{hash-short}.{ext}` | 路径检查/迁移要求严格三段结构，第三段同时含 `{filename}` 与 `{ext}` |
| 测试连接 | — | 验证带签名 Bucket 读取，不验证完整上传/公开显示流程 |

### 自动处理、路径与安全

| 设置项 | 默认值 | 真实行为 |
| --- | --- | --- |
| 启用插件 | 开启 | 总开关；关闭后自动处理、手动命令、迁移和延迟清理都停止 |
| 粘贴/拖拽图片自动上传 | 关闭 | 仅在当前 Markdown 已保存为 `TFile` 且属于 `staging` / `managed` 时接管；上传后持有对象锁，直到链接确认写入笔记 |
| 自动转存网络图片 | 关闭 | 可写笔记稳定约 5 秒后转存标准 HTTP(S) 图片，开关立即生效 |
| 上传后将原附件移入回收站 | 关闭 | 只影响镜像外原附件；共享附件建议保持关闭 |
| 单张图片最大下载体积 | 10 MiB | 只限制外部网络图片转存 |
| 移动笔记时同步 S3 图片路径 | 开启 | 目标为 `managed` 的单篇笔记立即迁移；整个文件夹移动时，内部 `managed` 笔记顺序迁移 |
| 路径迁移后清理旧对象 | 开启 | 与笔记删除开关独立；只把已确认精确版本的迁移旧对象放入宽限队列 |
| 目录处理范围 | 旧版排除目录 | 新用户建议配置完成后切到目录策略 |
| 目录策略规则 | 空 | `staging`、`managed`、`verify`、`ignore`；未匹配默认忽略 |
| 不处理的笔记路径 | 空 | 只在旧版范围模式中出现；其余路径视为 managed |
| 不参与路径同步的云端键前缀 | `mpclipper` | 不迁移、不自动删除；校对时标为受保护对象，`ignore` 中的引用也会保护对象 |
| 本地镜像目录 | `98 cloudflareR2` | 本地相对路径必须与云端对象键一致 |
| 默认链接模式 | 本地 | 只决定新链接形式；两种模式都上传并建镜像 |
| 删除笔记时同步删除云端图片 | 关闭 | 只控制真实删除/启动缺失的笔记；与迁移旧对象清理独立，开启后也先进入宽限队列 |
| 补处理 Obsidian 关闭期间的变化 | 开启 | 有基线后只处理新增/变化笔记；目录策略无基线时顺序处理既有 `staging` / `managed`，失败项持久到下次启动 |
| 删除宽限期 | 10 分钟 | 最少 1 分钟；任一删除开关开启时显示，并同时作用于两类队列 |
| 将空的镜像目录移入回收站 | 开启 | 仅镜像根内且确实为空的父目录 |

### 图片、压缩与定时扫描

| 设置项 | 默认值 | 作用与注意事项 |
| --- | --- | --- |
| WebP 压缩 | 关闭 | 上传前转为 WebP；编码失败时回退原格式 |
| WebP 压缩质量 | 80 | 1–100；越高通常越清晰、越大 |
| WebP 跳过格式 | `svg, gif` | 默认保留矢量和动画格式 |
| 图片文件夹 | 留空，即整个 Vault | 只限制定时扫描和全库候选预览；手动当前文档扫描不受限 |
| 定期自动扫描全库 | 关闭 | 仅桌面端周期运行 |
| 扫描间隔 | 30 分钟 | 最少按设置读取的有效分钟数运行 |
| 跳过最近修改文件 | 600 秒 | 避免自动处理正在写入的笔记和附件 |
| 自动扫描最小体积 | 0 MiB | 0 表示不按全局体积跳过 |
| 默认图片类型 | png、jpg、jpeg、gif、webp、svg、heic、bmp、tiff | 可逐类启用/停用 |
| 每种类型最小大小 | 0 MiB | 只在执行对应扫描规则时过滤 |
| 定时扫描包含 | 默认图片类型全部包含 | 控制哪些扩展名进入定时候选 |
| 自定义图片类型与替换格式 | 空 | 未知扩展名可按普通 Markdown 链接处理 |

### 最近活动与内部数据

设置页会显示最近活动以及待延迟删除数量。日志用于排查上传、切换、扫描和删除失败或保护结果，不是永久审计数据库；保存设置时只保留最近一部分记录。

`data.json` 还保存：

- 笔记增量索引；
- 尚未成功完成的启动补处理路径；
- 待延迟删除队列及中断恢复标记；
- 插件已上传对象的存储身份、SHA-256、大小等版本化所有权记录；
- 最近活动。

请把整个 `data.json` 当作敏感文件处理。

## 常用工作流

### 云端优先：粘贴截图

1. 设置默认链接模式为“云端”。
2. 开启“粘贴/拖拽图片自动上传”。
3. 先确认当前 Markdown 已经保存到 Vault，且位于 `staging` 或 `managed`，再粘贴截图。
4. 等待占位文字变成云端图片链接。
5. 插件同时在镜像目录中保存相同对象键的图片。

上传完成后，对象键操作锁会继续保持，直到插件确认新链接确实写入笔记文件。如果在等待时间内没有落盘，插件会提示并把相关延迟删除任务向后推，而不是立即释放后让清理流程抢先处理这个对象。

### 处理已有本地图片

1. 打开目标笔记。
2. 小云朵 → “扫描当前文档图片”。
3. 检查候选并取消不需要的图片。
4. 上传并替换。
5. 如果开启了原附件回收，检查 Obsidian 回收站以及其他笔记的共享引用。

### 网页剪藏与其他插件

- 手动：打开笔记并运行“扫描当前文档图片”。
- 自动：开启“自动转存网络图片”。新建或修改笔记稳定约 5 秒后处理。
- 由其他插件管理的对象键前缀，例如 `mpclipper`，保留在受保护前缀设置中。

### 新设备需要本地镜像

1. 先同步 Vault 和插件设置。
2. 测试 S3 连接；镜像下载使用带签名 GET，不要求对象公开。
3. 运行“一键下载云端图片至本地镜像”。
4. 处理失败项。
5. 需要离线显示时，再把链接切到本地；若仍要使用云端链接显示，另行用浏览器验证公开/受控访问 URL。

### 大规模整理前后

1. 整理前运行快速校对并备份。
2. 确认目录策略，尤其是源目录和目标目录。
3. 完成移动或整理。
4. 等待后台补处理完成。
5. 再运行快速校对。
6. 对路径不一致的 `managed` 笔记运行全量重同步；`staging` 不需要按临时路径定稿，`verify` 只读报告。
7. 不要为了让数字归零而直接删除“未引用对象”；先检查备份目录和外部工具。

## 故障排查

### Agent 生成的笔记没有自动上传

依次检查：

1. 插件总开关是否开启；
2. 笔记目录是否为 `staging` 或 `managed`；
3. 默认链接模式是否为“云端”；如果是本地模式，普通 create/modify 不自动接管本地附件；
4. 图片链接是否为标准 Wiki / Markdown，并能解析到实际文件；
5. 图片类型是否已启用；
6. 网络图片是否开启自动转存；
7. Obsidian 关闭期间生成时，“补处理关闭期间的变化”是否开启；目录策略首次无基线会处理既有可写笔记，旧版范围模式首次只建基线；
8. 设置页“最近活动”是否记录失败。

如果是粘贴/拖拽，请再确认当前 Markdown 已先保存到 Vault。没有实际 `TFile` 的临时编辑器不会被插件接管。

### 启动提示“发现 N 篇笔记的图片路径不一致”

这只表示对象键不符合当前笔记目录/名称，不代表云端一定丢失。

1. 先运行快速校对；
2. 确认图片是否由本插件管理；
3. 其他工具对象加入受保护前缀；
4. 对 `managed` 目录运行“重新同步全部 S3 图片路径”；`verify` 的提示只供人工检查，`staging` 不会产生规范路径提示；
5. 不需要先切到云端模式。

如果刚刚移动的是整个文件夹，且同步开关已开启，插件会先重建索引，再逐篇迁移其中的 `managed` 笔记；迁移期间仍可能先看到进度或完整性提示。失败项会保留到下次启动，也可以在备份后运行全量重同步复查。

### 重同步出现 `NoSuchKey / 404`

1. 运行快速校对确认“缺少云端对象”和“缺少本地镜像”；
2. 如果旧镜像存在，1.7.0 会尝试用镜像恢复新对象；
3. 如果源云端和旧本地镜像都不存在，插件无法确认正确字节；即使目标键已有同名对象，也会拒绝自动改链接；
4. 不要只把 Markdown URL 改成一个看似正确、实际不存在的路径。

### 测试连接失败

| 错误 | 常见原因 | 处理 |
| --- | --- | --- |
| 403 / AccessDenied | Token 权限不足或 Bucket 范围错误 | 重新创建目标 Bucket 的 Read & Write Token |
| 404 / NoSuchBucket | Bucket 名称或 Endpoint 错误 | 从控制台重新复制 |
| SignatureDoesNotMatch | Region、Endpoint、系统时间或密钥错误 | 核对 Region，校准系统时间，重新复制凭据 |
| 网络错误 | API 域名、代理或防火墙问题 | 确认 Endpoint 可访问 |

### 上传成功，但云端图片不显示

- 用无痕浏览器打开完整图片 URL；
- 403 表示公开访问未正确配置；
- 404 可能是公开域名指向了不同 Bucket，或对象键不一致；
- 不要把 S3 API Endpoint 当作公开访问 URL；
- 检查 URL 中中文和空格是否只被编码一次。

### 切换到本地没有变化

- 精确本地镜像不存在：先一键下载；
- 笔记在 `verify` 或 `ignore`；
- URL 不属于当前前缀，也没有登记为历史 URL 前缀；
- 链接不是支持的标准 Markdown 图片格式；
- 修改过镜像根目录，但文件仍留在旧位置。

### 快速校对很慢或显示大量孤儿

- 校对会分页读取整个 Bucket，而不是只读当前笔记路径；
- 大 Bucket 需要多次网络请求；
- 与其他程序共用 Bucket 时，无关对象会显示为孤儿；
- 为外部工具设置受保护前缀，长期建议使用专用 Bucket；
- `ignore` 中能识别的引用会保护对应对象，不会让它仅因被忽略笔记引用而显示为孤儿；
- 深度校对只计算受审核引用对应的本地镜像哈希，并 HEAD 受引用云端对象。

### 删除笔记后云端文件没有立即消失

这是预期行为。检查：

- 删除同步是否开启；
- 是笔记删除，还是路径迁移：两者由不同开关控制；
- 宽限期是否到期；
- 是否仍被任何 Markdown 笔记引用，包括忽略目录；
- 是否命中受保护前缀；
- 是否能确认对象由本插件拥有，且远端哈希与大小仍是排队时的精确版本；
- 是否更换了 Endpoint、Bucket、镜像根或凭据身份；
- 云朵菜单“处理延迟删除图片”只处理已到期任务。

### WebP 压缩失败

插件会提示并回退上传原格式。确认 `main.js` 来自完整 Release；GIF 和 SVG 建议保留默认跳过。必要时关闭 WebP，再用测试图片复现。

### 如何提交有效 Issue

请附上：

- 插件版本和 Obsidian 版本；
- 桌面端或移动端；
- 存储服务商类型；
- 目录模式和相关规则；
- 操作步骤、提示文字和错误状态码；
- 可公开的最小示例。

务必遮住 Access Key、Secret、私人域名、真实笔记标题和业务内容。桌面端通常可以用 `Ctrl + Shift + I` 打开开发者控制台，但不要把包含隐私的整段日志直接公开。

## 隐私与安全

### 凭据

- Access Key 和 Secret Access Key 保存在插件本地 `data.json` 中。
- 设置输入框的密码样式只负责界面遮挡，不表示文件已加密。
- 使用只限一个 Bucket 的最小权限 Token。
- 如果 `.obsidian` 会被同步，确认同步服务的加密和共享权限。
- 凭据一旦出现在公开仓库、聊天或截图中，应立即撤销并重新生成。

### 公开图片与路径泄露

默认规范路径包含笔记目录和笔记名。即使图片内容不敏感，URL 也可能泄露：

- 客户名称；
- 项目代号；
- 个人姓名；
- 笔记主题和分类结构。

需要保密时，使用私有存储和受控访问方案，或为敏感目录关闭本插件；不要把公开图床当作私密文档库。

### 网络请求

插件没有实现遥测或使用统计。它会在以下情况下联网：

- 访问你配置的 S3 / R2 Endpoint；
- Obsidian 显示云端链接时读取你配置的当前或历史图片域名；插件镜像下载本身使用带签名 Endpoint；
- 转存网络图片时访问原始 URL。

远程站点可能通过普通网络日志看到你的 IP 和请求时间。

### 本地与云端删除

- 本地精确镜像和空目录使用 Obsidian 回收站机制；实际可恢复性取决于 Obsidian 的删除设置和同步工具。
- 云端对象删除是否可恢复取决于 Bucket 版本、备份或服务商策略。
- AWS S3 自动删除只针对插件拥有、存储身份一致且操作 ID、ETag、SHA-256、大小全部匹配的对象版本；R2、MinIO、自定义服务商保留云端对象。
- 快速/深度校对绝不执行删除。
- “未引用”只是校对结论，不是自动删除授权。

### WebP

WebP 质量压缩可能是有损的。插件保存的镜像与最终上传字节一致，但不一定与原始图片逐字节一致。重要原图请保留独立备份，并保持“上传后将原附件移入回收站”为关闭。

## 当前限制

- 自动识别以标准 Markdown / Wiki 链接为主，不支持 HTML、Base64 和所有第三方插件内部格式。
- 网络图片转存无法处理要求登录、Cookie、Referer 或复杂防盗链的网站。
- 路径同步要求严格三段模板：前两段恰好为 `{notedir}/{notename}`，第三段同时含 `{filename}` 与 `{ext}`。
- `staging` 可上传、下载和改链接，但不做规范路径检查或迁移；只有 `managed` 可迁移。
- 第一次启用启动补处理时，旧版范围模式只建立基线；目录策略模式会顺序处理既有 `staging` / `managed` 笔记，首次范围较大时需要等待。
- 云端模式会后台接管普通本地图片；本地模式不会仅因 create/modify 自动上传本地附件。
- 快速与深度校对读取整个 Bucket；目前不能限制到某个 Bucket 前缀。
- 深度校对依赖上传时写入的 SHA-256 元数据；旧对象可能一直显示“尚未深度验证”。
- 校对窗口只读，不提供一键修复、批量孤儿删除或报告导出。
- `ignore` 笔记不生成普通校对问题，但可识别引用会作为保护引用；不支持的特殊语法仍可能无法保护对象。
- “一键下载”使用带签名 S3 GET，可用于私有 Bucket；但云端模式的 Markdown 显示仍需要 Obsidian 能读取当前链接地址，插件不会为显示链接生成临时签名 URL。
- 历史 URL 前缀按存储身份隔离，只能用于同一对象键空间的旧别名；切换 Bucket、Endpoint、镜像根或 Access Key 身份后，不会跨身份自动寻找、搬运或删除对象。
- 云端对象没有真实目录，插件不会递归删除未知前缀。
- 整个文件夹移动/重命名会顺序迁移其中的 `managed` 笔记；大文件夹需要时间，失败项留待下次启动或全量重同步复查。
- 定时全库扫描仅桌面端运行；移动端会在启动时和手动命令中检查到期删除。
- 自动删除仅适用于 1.7.0 以后由本插件创建、能确认四重版本信息的 AWS S3 对象；旧版、外部、R2、MinIO、自定义服务对象会保留。
- AWS S3 通过 `If-Match` ETag 原子条件删除；R2 当前未提供插件可依赖的同等文档保证，因此不执行自动物理删除。

## 开发、测试与发布

环境要求：Node.js 24 或更高版本、npm。

```bash
git clone https://github.com/hailanbb/s3-image-sync-pro.git
cd s3-image-sync-pro
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

开发监听构建：

```bash
npm run dev
```

当前自动化测试包括：

- 规范路径、模板变量和镜像相对键；
- Wiki / Markdown 镜像引用；
- 目录策略解析、最长匹配和权限；
- 延迟删除的引用/所有权辅助规则；
- 三方校对异常分类；
- ListObjectsV2 XML、分页查询和 SigV4 规范化。

这些是单元和协议解析测试，不等于真实 Obsidian、Cloudflare R2、AWS S3 和移动端的完整集成测试。发布前仍应使用测试 Vault 和测试 Bucket 验证关键流程。

GitHub Actions 分成两条流水线：

- **CI**：推送到 `master` 或向 `master` 提交 Pull Request 时，在 Node.js 24 上依次执行依赖锁定安装、测试、类型检查、官方 Obsidian 规则 Lint、版本元数据校验和生产构建；同一分支的新运行会取消旧运行。
- **Release**：推送 Tag 后再次执行版本校验、测试、类型检查、Lint 和构建；只有 Tag 与 `manifest.json` / npm 版本精确一致时才能发布。随后为 `main.js`、`manifest.json`、`styles.css` 生成 GitHub artifact attestation，并把这三个文件附加到带自动发行说明的 Release。

本地分支执行 `npm run verify-release` 只检查版本文件一致性；GitHub 的 Tag 环境还会额外检查 Tag 名，避免普通分支名被误当成版本号。

发布时应保持：

- `package.json`、`package-lock.json`、`manifest.json` 的插件版本一致；
- Git Tag 和 GitHub Release 使用相同版本；
- `versions.json` 新增“插件版本 → 最低 Obsidian 版本”的映射，而不是把所有值改成插件版本。

项目采用 [MIT License](LICENSE)，基于并扩展 [jongchoiyip/s3-image-sync](https://github.com/jongchoiyip/s3-image-sync)。架构演进见 [docs/CHANGES.md](docs/CHANGES.md)。

## 版本记录与 1.5.5 说明

| 版本 | 重点 | 状态 |
| --- | --- | --- |
| 1.7.1 | 修复社区目录审核项，并把官方 Obsidian ESLint 规则和描述规范纳入本地检查及 CI | 当前文档与当前代码版本 |
| 1.7.0 | 四种目录策略、启动补处理、签名下载、历史 URL、事务式路径迁移、版本化延迟删除、三方一致性校对与 CI/Release 防漂移 | 历史版本；因描述规范错误已被社区目录撤下，请升级到 1.7.1 |
| 1.6.9 | 本地镜像孤儿恢复、镜像精确键上传、切换到云端前先上传、Agent/脚本写入后的后台接管 | 历史版本 |
| 1.6.5–1.6.8 | 云端/镜像规范路径、Obsidian 源码规范、受保护键前缀与路径同步安全边界 | 历史版本 |
| 1.5.5 | 仓库历史中存在对应版本内容，但此前缺少匹配的 Git Tag / GitHub Release；现已补发历史标签与 Release，`versions.json` 也恢复 `1.5.5 → Obsidian 1.6.6` 兼容映射 | 已补发历史 Release；不作为 Latest |

日常安装请始终使用 [Latest Release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest)。补发 1.5.5 只是修复发布历史完整性，不代表它比 1.7.1 更新，也不建议把 1.7.1 降级覆盖成 1.5.5。更完整的技术演进见 [docs/CHANGES.md](docs/CHANGES.md)。

## English overview

S3 Image Sync Pro 1.7.1 is an Obsidian plugin for Cloudflare R2, AWS S3, MinIO, and other S3-compatible object stores. It manages three related views of an image: the Markdown reference, the local mirror inside the vault, and the cloud object.

Its core invariant is:

```text
S3 object key
  == path relative to the configured local mirror root
  == key decoded from a recognized current/historical cloud URL
     or stripped from a local-mirror link
```

Cloud vs. Local link mode only changes the link written into Markdown. Every successful upload still creates both the cloud object and the exact local mirror.

### Highlights in 1.7.x

- Four path-policy modes: `staging`, `managed`, `verify`, and `ignore`.
- `staging` accepts and mirrors incoming images without canonical path migration; `managed` owns the final note-derived object path. `verify` is read-only, while `ignore` references still protect objects from orphan classification and deletion.
- Persistent, sequential startup catch-up. With an existing baseline it processes new or changed notes; a first run in directory-policy mode also queues existing `staging` / `managed` notes, while legacy mode only establishes a baseline. Failed notes remain queued for the next startup.
- Cloud-mode background adoption of supported local images created by agents, scripts, Obsidian, or other plugins.
- Authenticated S3 GET downloads with final-byte SHA-256 checks; private buckets can populate the local mirror even though Cloud link display still needs a browser-readable URL.
- Storage-identity-bound historical URL prefixes for downloads, toggles, audits, and migration to the current URL prefix; switching buckets does not reuse an old bucket's aliases.
- Transactional path migration for `managed` notes: signed byte reads, create-only writes, collision checks, verified mirrors, and Markdown rewrite in that order.
- Two opt-in cleanup switches for AWS S3, using operation ID + ETag + SHA-256 + size ownership, `If-Match` conditional DELETE, a grace period, a fresh whole-vault reference scan, write-ahead recovery, protected prefixes, and local recovery copies. R2/MinIO/custom providers preserve remote objects.
- Read-only three-way consistency checks across note references, the local mirror, and the complete S3 bucket listing.
- Optional deep SHA-256 verification for referenced local mirrors and referenced cloud objects that carry plugin-written hash metadata.

### Important boundaries

- Canonical path checks and migration require exactly three template segments: `{notedir}/{notename}/<filename segment>`, with both `{filename}` and `{ext}` in the third segment.
- With path sync enabled, folder moves rebuild the index and then migrate contained `managed` notes sequentially; failed notes remain queued for retry.
- Quick and deep audits never repair or delete data.
- Legacy or third-party cloud objects without SHA-256 metadata are reported as unverified rather than corrupted.
- Standard Markdown/Wiki image references are supported; HTML, Base64 data, and arbitrary plugin-internal formats are not guaranteed.
- A public image domain may expose image content as well as note-directory and note-title information contained in object keys.
- AWS S3 cleanup uses signed `If-Match` conditional DELETE. R2, MinIO, and custom providers are preserved because the plugin cannot rely on equivalent documented semantics.
- The missing historical 1.5.5 tag and GitHub Release have been backfilled. Install the [latest release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest) for normal use.

For installation, R2 setup, safety rules, directory-policy examples, agent workflows, troubleshooting, and release instructions, follow the Chinese guide above. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest) and place them in `<vault>/.obsidian/plugins/s-three-image-sync-pro/`.
