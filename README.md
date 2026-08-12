# S3 Image Sync Pro

[![GitHub release](https://img.shields.io/github/v/release/hailanbb/s3-image-sync-pro?display_name=tag&sort=semver)](https://github.com/hailanbb/s3-image-sync-pro/releases/latest)
[![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A5%201.6.6-7C3AED)](https://obsidian.md/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

> 面向 Obsidian 的 S3 / Cloudflare R2 图床、图片本地镜像与路径同步插件。

[下载最新版](https://github.com/hailanbb/s3-image-sync-pro/releases/latest) · [提交问题](https://github.com/hailanbb/s3-image-sync-pro/issues) · [版本记录](docs/CHANGES.md) · [English summary](#english-summary)

S3 Image Sync Pro 可以把 Obsidian 笔记中的图片上传到 Cloudflare R2、AWS S3、MinIO 或其他 S3 兼容存储，同时在 Vault 内保留一份路径完全对应的本地镜像。你可以让笔记使用云端 URL，也可以随时切换为本地路径。

如果你第一次接触 S3、R2、Bucket 或对象键，不必担心：本文会从名词解释开始，按顺序完成安装、配置和第一次上传。

## 目录

- [先用 30 秒理解它](#先用-30-秒理解它)
- [核心功能](#核心功能)
- [使用前须知](#使用前须知)
- [安装与升级](#安装与升级)
- [Cloudflare R2 新手配置](#cloudflare-r2-新手配置)
- [其他 S3 服务商配置](#其他-s3-服务商配置)
- [第一次使用](#第一次使用)
- [路径与链接是怎样对应的](#路径与链接是怎样对应的)
- [设置项完整说明](#设置项完整说明)
- [左侧“小云朵”菜单完整说明](#左侧小云朵菜单完整说明)
- [常用工作流](#常用工作流)
- [排错指南](#排错指南)
- [安全、隐私与删除策略](#安全隐私与删除策略)
- [当前限制](#当前限制)
- [开发与构建](#开发与构建)
- [English summary](#english-summary)

## 先用 30 秒理解它

插件同时管理三样东西：

1. **云端对象**：真正上传到 R2 / S3 Bucket 的图片。
2. **本地镜像**：保存在 Obsidian Vault 内的一份相同图片。
3. **笔记链接**：笔记里显示图片时使用云端 URL，或使用本地镜像路径。

最重要的规则只有一条：

```text
云端 S3 对象键 = 本地镜像目录下的相对路径
```

假设有一篇笔记：

```text
03 已整理/我的教程.md
```

上传后的文件可能是：

```text
云端对象键：03 已整理/我的教程/screenshot-a1b2c3....webp
本地镜像：  98 cloudflareR2/03 已整理/我的教程/screenshot-a1b2c3....webp
```

笔记可以任选一种链接：

```markdown
<!-- 云端模式 -->
![截图](https://img.example.com/Projects/Tutorial/screenshot-a1b2c3....webp)

<!-- 本地模式 -->
![截图](98%20cloudflareR2/03%20已整理/我的教程/screenshot-a1b2c3....webp)
```

即使“默认链接模式”选择了**云端**，插件也会同时写入本地镜像。链接模式只决定笔记写哪种链接，不决定图片是否保存到本地。

## 核心功能

- 支持 Cloudflare R2、AWS S3、MinIO 和自定义 S3 兼容服务。
- 上传本地图片后自动改写笔记链接，并同步写入云端对象和本地镜像。
- 支持云端链接与本地链接双向切换。
- 可从云端批量补齐本地镜像，方便新设备或离线使用。
- 笔记移动或重命名后，可同步新的云端路径和镜像路径。
- 可设置完全不处理的笔记目录。
- 可设置“不参与路径同步”的云端键前缀，避免与其他插件争夺图片路径管理权。
- 可转存笔记中的外部网络图片，减少原站失效带来的图片丢失风险。
- 可选 WebP 压缩，上传前降低图片体积。
- 支持粘贴和拖拽图片自动上传。
- 扫描 Markdown 时会避开行内代码和代码块。
- 网络删除、远程图片下载具备重试；关键上传流程具备失败回滚。
- 中文和英文界面；桌面端与移动端均可安装，定时全库扫描仅桌面端提供。

## 使用前须知

### 你需要准备什么

- Obsidian **1.6.6 或更高版本**。
- 一个 S3 兼容对象存储，例如 Cloudflare R2。
- 一个 Bucket（存储桶）。
- 对该 Bucket 有读写权限的 Access Key ID 和 Secret Access Key。
- 一个能公开读取图片的 URL，例如 R2 的自定义域名或 `r2.dev` 地址。

### 新手先认识这些名词

| 名词 | 简单解释 |
| --- | --- |
| Vault | 你的整个 Obsidian 笔记库目录。 |
| S3 / R2 | 用于保存文件的云端对象存储服务。R2 兼容 S3 接口。 |
| Bucket / 存储桶 | 云端保存图片的“容器”，类似一个顶层文件夹。 |
| Endpoint / 端点 | 插件向存储服务上传、复制、删除对象时访问的 API 地址。 |
| Access Key | 插件操作 Bucket 时使用的身份凭据。它不是公开图片地址。 |
| 公开访问 URL | 笔记显示云端图片时使用的地址前缀，浏览器必须能直接访问。 |
| 对象键 / Object key | 图片在 Bucket 内的完整路径，例如 `项目/笔记/图片.webp`。 |
| 本地镜像 | Vault 内按相同对象键保存的图片副本。 |
| 链接模式 | 决定笔记写入云端 URL，还是本地镜像路径。 |

### 第一次使用时的安全建议

1. 先备份 Vault，或确保你的同步工具保留文件历史版本。
2. 先保持“删除笔记时同步删除云端图片”为关闭状态。
3. 先用一篇测试笔记和一张测试图片完成整个流程。
4. 确认云端图片和本地镜像都能打开后，再处理正式笔记。
5. 第一次使用全库功能前，先运行“扫描全库图片但不替换”。它只做预览，不改文件。

## 安装与升级

### 手动安装（当前最稳妥）

1. 打开 [最新 Release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest)。
2. 下载 `main.js`、`manifest.json`、`styles.css` 三个文件。
3. 在你的 Vault 内创建插件目录：

   ```text
   <你的 Vault>/.obsidian/plugins/s-three-image-sync-pro/
   ```

4. 把三个文件复制到该目录：

   ```text
   <你的 Vault>/.obsidian/plugins/s-three-image-sync-pro/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

5. 重启 Obsidian，进入“设置 → 第三方插件”，启用 **S3 Image Sync Pro**。

> `.obsidian` 通常是隐藏目录。如果看不到它，请先在文件管理器中开启“显示隐藏文件”。

如果你已能在社区插件商店中搜索到 **S3 Image Sync Pro**，也可直接安装；若搜索不到，请使用手动安装，GitHub Release 是本项目的正式安装来源。

### 如何升级

1. 停用插件或关闭 Obsidian。
2. 从最新 Release 下载三个安装文件并覆盖旧文件。
3. **不要删除 `data.json`**，它保存你的插件设置。
4. 重新启动并确认版本号。

当前版本为 **1.6.8**，最低支持 Obsidian **1.6.6**。历史兼容关系见 [`versions.json`](versions.json)。

## Cloudflare R2 新手配置

Cloudflare R2 是本插件的推荐服务商。下面只描述插件所需的最小配置。

### 第 1 步：创建 Bucket

1. 登录 Cloudflare 控制台，打开 **R2 Object Storage**。
2. 创建一个 Bucket，例如 `obsidian-images`。
3. 记住 Bucket 名称。

### 第 2 步：创建 API 凭据

1. 在 R2 页面找到 **Manage API Tokens**。
2. 创建 R2 API Token。
3. 至少授予目标 Bucket 的 **Object Read & Write** 权限。
4. 保存 Access Key ID 和 Secret Access Key。

Secret Access Key 通常只显示一次，请妥善保管。Cloudflare 官方步骤见 [R2 Authentication](https://developers.cloudflare.com/r2/api/s3/tokens/)。

### 第 3 步：得到 Endpoint

普通 R2 Bucket 的 Endpoint 格式为：

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

把 `<ACCOUNT_ID>` 换成你的 Cloudflare Account ID。EU 或 FedRAMP jurisdiction 的地址不同，请以控制台显示为准。

### 第 4 步：开启图片公开访问

云端链接要在 Obsidian 中显示，浏览器必须能直接读取图片。R2 Bucket 默认并不公开。

你可以选择：

- **自定义域名**：适合长期使用，例如 `https://img.example.com`。
- **R2.dev 开发地址**：适合测试，Cloudflare 明确说明它不适合生产流量。

在 Bucket 的 Settings 中配置 Custom Domain，或启用 Public Development URL。官方说明见 [R2 Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)。

### 第 5 步：填写插件设置

| 插件字段 | R2 应填写什么 | 示例 |
| --- | --- | --- |
| 存储服务商 | Cloudflare R2 | `Cloudflare R2（推荐）` |
| 端点 URL | R2 S3 API Endpoint | `https://abc123.r2.cloudflarestorage.com` |
| 存储桶名称 | 你创建的 Bucket 名 | `obsidian-images` |
| Access Key ID | Token 生成的 Access Key ID | 不要公开 |
| Secret Access Key | Token 生成的 Secret Access Key | 不要公开 |
| 公开访问 URL | 自定义域名或 R2.dev 地址，不要在末尾加对象路径 | `https://img.example.com` |
| 上传路径模板 | 建议保留默认值 | `{notedir}/{notename}/{filename}-{hash-short}.{ext}` |

点击“**测试连接**”。看到“连接测试通过”后，再进行第一次上传。

> Endpoint 用于 API 操作，公开访问 URL 用于显示图片。两者不是同一个概念，不能互相替代。

## 其他 S3 服务商配置

| 服务商 | Endpoint | Region | 公开访问 URL |
| --- | --- | --- | --- |
| AWS S3 | 按 Bucket 所在区域填写对应 S3 Endpoint | 必须与 Bucket 区域一致 | 公开 Bucket URL 或 CDN / 自定义域名 |
| MinIO | 你的 MinIO API 地址 | 由部署配置决定 | 能公开读取对象的网关或域名 |
| 自定义 S3 | 服务商提供的 S3 API 地址 | 按服务商要求填写 | 能直接访问图片的公共地址 |

测试失败时，优先核对 Endpoint、Region、Bucket 名称和 Access Key 权限。

## 第一次使用

建议按下面顺序完成一次最小测试。

### 1. 保留推荐默认设置

```text
本地镜像目录：98 cloudflareR2
默认链接模式：本地
上传路径模板：{notedir}/{notename}/{filename}-{hash-short}.{ext}
```

如果主要在多设备间使用云端图片，也可把链接模式改为“云端”。无论选择哪一种，插件都会同时写入本地镜像。

### 2. 创建测试笔记

例如创建 `测试/S3 图片测试.md`，放入一张图片；或者开启“粘贴/拖拽图片自动上传”后直接粘贴截图。

### 3. 使用“小云朵”上传

点击 Obsidian 左侧栏的云朵图标，选择“**扫描当前笔记图片**”。

- 本地候选图片会先显示选择窗口。
- 确认后，插件上传图片、写入本地镜像、改写笔记链接。
- 成功改写后，原始本地附件会被移入 Obsidian 回收站；镜像文件仍保留。

### 4. 验证三处结果

1. 笔记中图片能正常显示。
2. R2 / S3 Bucket 中出现了对应对象。
3. Vault 的 `98 cloudflareR2/` 下出现了相同相对路径的镜像文件。

三项都正常后，再开始处理正式笔记。

## 路径与链接是怎样对应的

### 推荐路径模板

默认模板是：

```text
{notedir}/{notename}/{filename}-{hash-short}.{ext}
```

当前 v1.6.8 支持以下变量：

| 变量 | 含义 |
| --- | --- |
| `{notedir}` | 笔记所在目录，例如 `项目/技术`。 |
| `{notename}` | 笔记文件名，不含 `.md`。 |
| `{filename}` | 原始图片文件名，不含扩展名。 |
| `{ext}` | 最终上传扩展名；启用 WebP 后可能是 `webp`。 |
| `{hash}` | 文件内容的完整 SHA-256 哈希。 |
| `{hash-short}` | SHA-256 的前 32 个字符。 |
| `{hash2}` | SHA-256 的前 2 个字符，适合大量文件分目录。 |
| `{yyyy}` | 当前年份，例如 `2026`。 |
| `{MM}` | 当前月份，两位数字。 |
| `{dd}` | 当前日期，两位数字。 |

### 为什么推荐不要随意改默认模板

“移动笔记时同步 S3 图片路径”“启动路径检查”和“重新同步全部 S3 图片路径”都以 `{notedir}/{notename}/...` 结构判断图片属于哪篇笔记。

改成 `attachments/{hash2}/{hash}.{ext}` 后，上传本身仍可工作，但插件无法再根据笔记目录和笔记名判断路径是否需要随笔记移动。需要路径同步时，请保留 `{notedir}/{notename}` 两层结构。

### 云端模式与本地模式

| 项目 | 云端模式 | 本地模式 |
| --- | --- | --- |
| 笔记中写入 | 公开访问 URL | Vault 内镜像路径 |
| 上传到 S3 / R2 | 是 | 是 |
| 写入本地镜像 | 是 | 是 |
| 无网络时显示 | 通常不行 | 可以 |
| 分享 Markdown 给他人 | 对方可访问公开 URL | 对方通常没有你的 Vault 路径 |

## 设置项完整说明

### 第一部分：连接云存储

| 设置项 | 作用 | 新手建议 |
| --- | --- | --- |
| 存储服务商 | 选择签名和 Region 规则。 | R2 用户选 Cloudflare R2。 |
| 区域 | AWS / MinIO / 自定义 S3 的 Region。R2 自动使用 `auto`。 | 必须与服务端一致。 |
| 端点 URL | S3 API 地址，用于上传、复制、删除和测试连接。 | 不要填公开图片域名。 |
| 存储桶名称 | 保存图片的 Bucket。 | 建议专门创建一个 Bucket。 |
| Access Key ID | API 身份凭据。 | 只授予必要 Bucket 的读写权限。 |
| Secret Access Key | API 密钥。 | 不要截图、提交到 GitHub 或发给他人。 |
| 公开访问 URL | 笔记云端链接的前缀。 | 用无痕窗口访问测试图片确认。 |
| 上传路径模板 | 决定对象键与镜像相对路径。 | 保留默认 `{notedir}/{notename}/...`。 |
| 测试连接 | 对目标 Bucket 发起带签名的读取测试。 | 配置后第一时间测试。 |

### 第二部分：基本设置

| 设置项 | 默认值 | 真实行为 |
| --- | --- | --- |
| 启用插件 | 开启 | 控制当前笔记扫描和自动行为；下载、链接切换、路径重同步等手动命令仍可单独运行。 |
| 粘贴/拖拽图片自动上传 | 关闭 | 拦截编辑器中的图片文件，直接上传、写入镜像并插入所选模式的链接。 |
| 自动转存网络图片 | 关闭 | 笔记创建或修改后等待约 5 秒，下载外部图片并转存；切换后立即生效。 |
| 单张图片最大下载体积 | 10 MiB | 只限制外部网络图片转存。 |
| 移动笔记时同步 S3 图片路径 | 开启 | 复制到新的规范对象键，补齐镜像并更新链接；旧云端对象保留。 |
| 不处理的笔记路径 | `06 已归档` | 每行一个 Vault 相对目录；受管批量功能会跳过这些笔记。 |
| 不参与路径同步的云端键前缀 | `mpclipper` | 只跳过路径移动、启动检查和重同步；显示、下载和切换仍可处理。 |
| 本地镜像目录 | `98 cloudflareR2` | 所有新上传图片必须在这里保留与对象键一致的副本。 |
| 默认链接模式 | 本地 | 只决定新写入笔记的是本地路径还是云端 URL。 |
| 删除笔记时同步删除云端图片 | 关闭 | 删除笔记时删除其未共享的云端对象和精确镜像；其他笔记仍引用的对象会保留，仅移除链接不会触发删除。 |
| WebP 压缩 | 关闭 | 上传前使用 WASM 转为 WebP；失败时回退上传原格式。 |
| WebP 压缩质量 | 80 | 1–100，越高越清晰、文件越大。 |
| WebP 跳过格式 | `svg, gif` | 默认保留动画和矢量格式。 |
| 定期自动扫描全库 | 关闭 | 仅桌面端；自动处理符合类型、目录、静默时间和体积条件的附件。 |
| 扫描间隔 | 30 分钟 | 自动扫描的执行间隔。 |
| 跳过最近修改的文件 | 600 秒 | 防止正在编辑的文件被自动处理。 |
| 自动扫描最小体积 | 0 MiB | 只影响自动扫描；0 表示不按体积跳过。 |

> “不处理的笔记路径”按目录边界匹配。填写 `06 已归档` 会忽略它和全部子目录，但不会误伤 `06 已归档备份`。

> 粘贴/拖拽自动上传同样遵守“不处理的笔记路径”。在这些笔记中，插件不会拦截事件，而是交回 Obsidian 按默认方式处理。

### 第三部分：图片类型

默认支持：`png`、`jpg`、`jpeg`、`gif`、`webp`、`svg`、`heic`、`bmp`、`tiff`。

开启“定期自动扫描全库”后，设置页会显示图片类型区域，可决定哪些扩展名参与扫描和定时处理，也可添加自定义扩展名。

手动“扫描当前笔记图片”的范围比自动扫描更宽：它不强制附件根目录、自动候选类型和最小体积规则，但仍会跳过 Markdown 文件、镜像目录中的文件、封面引用和代码区域。

> 定时扫描和“扫描全库图片但不替换”只处理“图片文件夹”设置中的目录，默认是 `90-笔记系统/92-附件`；v1.6.8 起可直接在设置页修改。手动扫描当前笔记不受该目录限制。

### 两种“排除设置”的区别

| 需求 | 应填写在哪一项 | 示例 |
| --- | --- | --- |
| 整个笔记目录都不希望本插件处理 | 不处理的笔记路径 | `06 已归档` |
| 图片由另一个插件管理，但仍需下载或切换链接 | 不参与路径同步的云端键前缀 | `mpclipper` |

例如云端键是 `mpclipper/2026/08/image.webp`，排除前缀 `mpclipper` 后，它不会因为笔记位置而被重排，但仍可下载到 `98 cloudflareR2/mpclipper/2026/08/image.webp`。

## 左侧“小云朵”菜单完整说明

点击 Obsidian 左侧栏的小云朵，会看到五项功能。

| 功能 | 作用范围 | 改笔记 | 改云端 | 改本地镜像 | 重要说明 |
| --- | --- | --- | --- | --- | --- |
| 扫描当前笔记图片 | 当前 Markdown 笔记 | 是 | 是 | 是 | 本地候选先选择；外部图片会尝试转存。成功后原本地附件移入回收站。 |
| 扫描全库图片但不替换 | 全库 | 否 | 否 | 否 | 只读预览，显示本地和远程候选数量及部分样例。 |
| 切换图片链接（本地 ↔ 云端） | 当前笔记或全库 | 是 | 否 | 否 | 切换到本地时，只有已存在镜像的图片才改写。 |
| 一键下载云端图片至本地镜像 | 全库受管笔记 | 否 | 否 | 是 | 已存在文件跳过，404 等错误计入失败。 |
| 重新同步全部 S3 图片路径 | 全库受管笔记 | 是 | 是 | 是 | 复制到规范新键并保留旧对象；跳过忽略目录和排除前缀。 |

### 1. 扫描当前笔记图片

- 解析 Wiki 嵌入、Wiki 链接、Markdown 图片和普通 Markdown 文件链接。
- 避开代码块和行内代码。
- 本地候选会显示预览窗口，可取消不想上传的图片。
- 外部 `http(s)` 图片如果看起来是图片，会下载并转存到自己的存储。
- 上传成功后先写入镜像，再改写链接；镜像失败时会回滚刚上传的云端对象。
- 笔记成功改写后，原始本地附件会移入 Obsidian 回收站。

如果同一原始附件还被其他笔记引用，移入回收站会使那些引用失效；确认上传前请先检查共享引用。

### 2. 扫描全库图片但不替换

这是全库操作前最推荐的预检查。它不上传、不删除、不改笔记，只统计符合自动扫描条件的本地候选和可转存的外部图片。

### 3. 切换图片链接（本地 ↔ 云端）

可选择“仅当前笔记”或“全库所有笔记”。

- 云端 → 本地：按对象键寻找镜像；找不到时保留原云端 URL，不生成失效链接。
- 本地 → 云端：把镜像目录后的相对路径作为对象键，拼接公开访问 URL。
- 完成后，“默认链接模式”也会更新为目标模式。
- 只处理标准 Markdown 图片语法 `![说明](地址)` 中属于本插件域名或镜像目录的链接。

准备切到本地前，建议先运行“一键下载云端图片至本地镜像”。

### 4. 一键下载云端图片至本地镜像

该功能只补齐镜像，不改笔记，也不移动云端对象。

```text
云端键：A/B/image.webp
下载到：<本地镜像目录>/A/B/image.webp
```

因此下载完成后再切到本地，路径可以直接对应。

### 5. 重新同步全部 S3 图片路径

适合修复旧笔记或批量移动笔记后遗留的路径不一致。插件会：

1. 根据当前笔记目录和笔记名计算规范路径。
2. 从旧对象键复制到新对象键。
3. 复制或补齐新路径的本地镜像。
4. 把笔记中的匹配云端 URL 或本地镜像链接改成新路径。
5. 保留旧云端对象作为安全备份，不自动删除。

运行前请注意：

- 它不会搜索整个 Bucket 并猜测图片位置，只能以笔记链接中的旧对象键为复制源。
- 如果旧对象键已不存在，会返回 `NoSuchKey / 404`，该项无法自动修复。
- 云端与本地链接都可直接重同步，不需要预先切换模式。
- 使用不含 `{notedir}/{notename}` 的路径模板时，无法可靠判断笔记归属。
- `mpclipper` 等已排除前缀不会参与重同步。

## 常用工作流

### 粘贴截图自动上传

1. 配好存储并测试连接。
2. 设置本地镜像目录和默认链接模式。
3. 开启“粘贴/拖拽图片自动上传”。
4. 在笔记中粘贴截图，等待占位文字变成正式图片链接。

每次成功上传都会同时产生云端对象和本地镜像。

### 处理已有笔记中的本地图片

1. 打开目标笔记。
2. 小云朵 → “扫描当前笔记图片”。
3. 在预览窗口取消不需要的图片。
4. 确认上传并替换。
5. 检查 Obsidian 回收站，确认原附件处理符合预期。

### 转存网页剪藏中的外部图片

手动方式：打开笔记，运行“扫描当前笔记图片”。

自动方式：开启“自动转存网络图片”，然后重载插件。新建或修改笔记约 5 秒后，插件会尝试转存外部图片。已经属于当前公开域名的图片会跳过。

### 新电脑或新手机需要本地图片

1. 先同步 Vault 和插件设置。
2. 确认存储配置有效。
3. 运行“一键下载云端图片至本地镜像”。
4. 确认失败数为 0，或处理失败链接。
5. 运行“切换图片链接”，目标选择“本地”。

### 移动或重命名笔记

保持“移动笔记时同步 S3 图片路径”为开启。插件会复制云端对象到与新笔记路径一致的位置、补齐新镜像并改写链接。旧对象会保留，确认新路径稳定后可自行在存储服务端清理。

### 与 MpClipper Sync 等其他插件共用域名

在“不参与路径同步的云端键前缀”中填写其他插件拥有的对象键根目录，例如 `mpclipper`。这样本插件仍能下载镜像和切换链接，但不会重排这些对象。

## 排错指南

### 测试连接失败

| 现象 | 常见原因 | 处理方法 |
| --- | --- | --- |
| 403 / AccessDenied | Key 权限不足、Key 填错、Bucket 范围不对 | 重新创建仅限目标 Bucket 的 Object Read & Write Token。 |
| 404 / NoSuchBucket | Bucket 名称或 Endpoint 错误 | 从服务商控制台重新复制。 |
| SignatureDoesNotMatch | Region、Endpoint、系统时间或密钥不一致 | 核对 Region，校准时间，重新复制密钥。 |
| 网络错误 | Endpoint 无法访问、代理或防火墙拦截 | 确认 API 域名可达。 |

### 上传成功，但云端图片不显示

1. 把完整图片 URL 放进浏览器无痕窗口打开。
2. 如果要求登录或返回 403，说明 Bucket 没有真正公开。
3. 如果返回 404，检查公开访问 URL 是否对应同一个 Bucket。
4. 检查自定义域名是否已经 Active。
5. 不要把 S3 API Endpoint 当作公开访问 URL。

### 切换到本地后没有变化

- 本地镜像不存在：先运行“一键下载云端图片至本地镜像”。
- 笔记位于“不处理的笔记路径”中。
- 修改过“本地镜像目录”，旧文件仍在原目录。
- 链接不是标准 Markdown 图片语法。
- 云端 URL 不属于当前配置的公开访问域名。

### 启动提示“发现 N 篇笔记的图片路径不一致”

开启“移动笔记时同步 S3 图片路径”后，插件加载约 10 秒会执行检查。提示表示至少一个受管对象键中的目录或笔记名与当前笔记路径不同。

1. 确认图片是否由本插件管理。
2. 其他插件管理的图片，把根前缀加入“不参与路径同步的云端键前缀”。
3. 整篇笔记不应处理时，把目录加入“不处理的笔记路径”。
4. 对本插件管理的图片，先切到云端模式，再运行“重新同步全部 S3 图片路径”。
5. 查看最终“已修复 / 失败”数量。

### 重新同步报 `NoSuchKey / 404`

这表示笔记 URL 中的旧对象键在 Bucket 内不存在，插件无法从不存在的对象复制出新对象。

先在 Bucket 中找到实际存在的图片对象，恢复到旧键，或在确认后复制到插件计算的新键。不要只把笔记 URL 改成一个“看起来存在”的路径，否则本地镜像、云端对象和笔记链接会再次失去一致性。

### WebP 压缩失败

插件会提示并尝试上传原格式。可暂时关闭 WebP 重试，确认 `main.js` 来自完整 Release，并对 GIF 和 SVG 保持默认跳过。详细错误可在 Obsidian 开发者控制台查看。

### 外部网络图片没有被转存

- URL 必须使用 `http` 或 `https`。
- 返回内容应为图片或 `application/octet-stream`。
- 单张图片不能超过最大体积。
- 目标笔记不能位于“不处理的笔记路径”。
- 已属于当前公开访问域名的图片会跳过。
- 需要登录、Referer 或防盗链验证的网站可能拒绝下载。

### 去哪里看日志

- 设置页底部“最近活动”显示近期记录，但不是完整审计日志。
- 桌面端通常可用 `Ctrl + Shift + I` 打开开发者控制台查看详细错误。
- 提交 Issue 时请附插件版本、Obsidian 版本、服务商类型、错误和复现步骤；务必遮住 Access Key、Secret、私人域名和笔记内容。

## 安全、隐私与删除策略

### 凭据安全

- Access Key 和 Secret Access Key 保存在本地插件设置 `data.json` 中。
- 不要把 `data.json` 提交到 GitHub、发到群聊或附在 Issue 中。
- 如果 `.obsidian` 会被同步到第三方服务，请确认其安全性和加密策略。
- 建议使用单独的、仅限目标 Bucket 的最小权限 Token。
- 密钥泄露后应立即撤销并重新生成。

### 网络与隐私

插件源码没有实现遥测或使用统计。它会在以下情况下发起网络请求：

- 连接你配置的 S3 / R2 Endpoint。
- 读取你配置的公开图片域名。
- 转存外部图片时访问原图片 URL。

公开访问 URL 意味着知道完整 URL 的人通常可以读取对应图片。不要把机密图片放入公开 Bucket。

### 高风险删除开关

“删除笔记时同步删除云端图片”默认关闭，建议新手保持关闭。

开启后，插件只在删除笔记时处理该笔记引用的受管图片。删除前会检查其他笔记的缓存引用：仍被引用的共享对象会跳过；未共享对象会删除云端文件及其精确本地镜像。仅从笔记中移除链接不会触发删除。

共享引用保护降低了误删风险，但仍建议保留存储桶版本控制或备份，因为插件只能识别受支持的 Markdown 图片链接。

关闭此开关时，删除笔记不会清理云端对象或本地镜像；“不处理的笔记路径”中的笔记始终跳过删除同步。

## 当前限制

- 插件以笔记中的链接为索引，不会主动列出整个 Bucket，也不会自动发现没有被笔记引用的孤立对象。
- 路径同步要求模板以 `{notedir}/{notename}/` 开头；纯哈希或日期路径仍可正常上传，但插件会安全跳过路径移动和重同步。
- 链接切换、下载和路径重写主要针对标准 Markdown 图片语法 `![说明](地址)`。
- 远程图片转存不支持必须登录、带 Cookie 或特殊防盗链请求头的网站。
- 定时全库扫描仅桌面端可用；移动端仍可使用手动扫描、上传、下载和链接切换。
- 当前内置文件分类以图片为主；自定义扩展名默认使用普通 Markdown 链接。
- 旧云端对象在路径同步成功后会保留，插件不会自动判断何时可以安全删除。

## 开发与构建

环境要求：Node.js 20 或更高版本、npm。

```bash
git clone https://github.com/hailanbb/s3-image-sync-pro.git
cd s3-image-sync-pro
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

开发监听构建：

```bash
npm run dev
```

`npm test` 覆盖规范路径、Vault 根目录键、日期模板和共享引用删除保护。生产构建会把 WebP 所需 WASM 资源打包进 `main.js`，Release 安装不需要额外下载 `.wasm` 文件。

GitHub Actions 在推送版本 Tag 后执行生产构建，并把 `main.js`、`manifest.json`、`styles.css` 附加到 Release。版本号需要在 `package.json`、`package-lock.json`、`manifest.json` 和 `versions.json` 中保持一致。

## 版本与许可证

- 当前版本：**1.6.8**
- 最低 Obsidian 版本：**1.6.6**
- 许可证：[MIT](LICENSE)
- 重大变更：[docs/CHANGES.md](docs/CHANGES.md)
- 本项目基于并扩展 [jongchoiyip/s3-image-sync](https://github.com/jongchoiyip/s3-image-sync)。

## English summary

S3 Image Sync Pro is an Obsidian plugin for Cloudflare R2, AWS S3, MinIO, and other S3-compatible object stores.

Its core invariant is:

```text
S3 object key == local mirror path relative to the configured mirror root
```

Every successful upload writes both the cloud object and the exact local mirror, even when Cloud link mode is selected. The plugin can switch Markdown image links between cloud and local forms, download cloud-linked images into the mirror, transfer external images, and copy objects to canonical note-based paths after notes are moved or renamed.

Follow the Chinese guide above for installation, configuration, safety notes, and troubleshooting. Download `main.js`, `manifest.json`, and `styles.css` from [the latest release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest), place them in `<vault>/.obsidian/plugins/s-three-image-sync-pro/`, then enable the plugin in Obsidian.
