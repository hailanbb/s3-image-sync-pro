# S3 Image Sync Pro

[中文说明](#中文说明)

**S3 Image Sync Pro** is a polished, modern, and mobile-friendly Obsidian plugin that scans local note images, uploads them to your S3-compatible cloud storage (Cloudflare R2, AWS S3, MinIO, etc.), and replaces local Markdown links with remote public URLs safely.

## Quick Start

1. Install the plugin and open **Settings → S3 Image Sync Pro**
2. Under **Step 1: Connect your cloud storage**, choose a provider (Cloudflare R2 recommended)
3. Fill in your credentials and click **Test connection**
4. Open a note containing local images and click the cloud icon in the left ribbon — done!

## ✨ Features

**🔥 5 Killer Pro Enhancements**
1. ⚡ **WebP WASM Compression**: Embedded local WebP encoder compresses heavy screenshots into modern, lightweight formats *before* uploading, drastically saving costs and boosting load speeds.
2. 🗂️ **Note-Path Organization**: Use `{notedir}` and `{notename}` variables to automatically mirror your Obsidian folder structure into your S3 bucket.
3. 🗑️ **Two-Way Delete Sync**: When you delete a note or image inside Obsidian, the plugin safely removes the corresponding file from S3 in the background. No more "ghost attachments"!
4. 🌐 **Remote Image Auto-Transfer**: Automatically detect, download, compress, and re-upload external web images (e.g., from Web Clipper) to S3 in the background. No local files generated!
5. 🔄 **S3 Path Auto-Sync**: When you move or rename a note, its associated S3 images are automatically moved to match the new path, keeping your cloud perfectly aligned with your vault.

**🛠️ More Powerful Features**
- **S3-Compatible Storage**: Works seamlessly with Cloudflare R2 (recommended), AWS S3, MinIO, or any S3-compatible provider.
- **Cross-Platform**: Fully functional on both Obsidian desktop and mobile with optimized, responsive UI.
- **Modern Gallery View**: Browse local images easily with lazy-loading previews and smooth selection controls.
- **Safe Replacement & Resilience**: Atomic note writes prevent concurrent-edit corruption; failed uploads auto-rollback; built-in exponential backoff for network failures.
- **Smart Parsing**: Intelligently ignores images inside fenced code blocks and inline code.

## Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, `styles.css`, and `*.wasm` files from the latest release.
2. Copy them to `<vault>/.obsidian/plugins/s3-image-sync-pro/`
3. Enable the plugin in Obsidian → Settings → Community Plugins.

## Configuration

### Step 1: Connect Your Cloud Storage

Choose your storage provider and fill in the credentials:

| Field | Description |
|-------|-------------|
| **Storage provider** | Cloudflare R2 (recommended), AWS S3, MinIO, or Custom S3 |
| **Endpoint URL** | Your storage endpoint, e.g. `https://abc123.r2.cloudflarestorage.com` |
| **Bucket name** | The bucket you created |
| **Access Key ID** | From your storage provider's API settings |
| **Secret Access Key** | From your storage provider's API settings |
| **Public access URL** | URL prefix for accessing files, e.g. `https://pub-xxx.r2.dev` |
| **Upload path template** | Default: `{notedir}/{notename}/{hash-short}.{ext}` (supports various path variables, see details below) |

Click **Test connection** to verify your settings.

#### Upload Path Template Variables

The **Upload path template** allows you to dynamically customize the S3 object key (path) for uploaded files. The following variables are supported:

- `{notedir}`: The relative path of the folder containing the current note.
- `{notename}`: The basename of the current note (without `.md`).
- `{ext}`: File extension (e.g. `png`, `jpg`).
- `{hash}`: 64-character full SHA-256 hash of the file.
- `{hash-short}`: 32-character short SHA-256 hash of the file.
- `{hash2}`: First 2 characters of the file hash (useful for folder partition/sharding).
- `{filename}`: Original file name (excluding extension).
- `{yyyy}`, `{MM}`, `{dd}`: Date components.

*Example:* `images/{notedir}/{notename}/{filename}-{hash-short}.{ext}` will upload a file matching your vault's exact folder structure!

### Step 2: Advanced Processing

- **WebP Compression**: Enable to automatically encode uploaded images to WebP. You can adjust the quality slider to find your perfect balance between size and quality.
- **Cloud Delete Sync**: Enable to auto-trash corresponding S3 images when you delete a note or an image inside Obsidian.

## Acknowledgments

This project is a heavily refactored and enhanced fork of the excellent [s3-image-sync](https://github.com/jongchoiyip/s3-image-sync) by [jongchoiyip](https://github.com/jongchoiyip). A huge thanks and profound respect to the original author for laying the incredible foundation that made this Pro version possible!

## License

MIT

---

## 中文说明

**S3 Image Sync Pro** 是一款优雅、轻量且对移动端深度优化的 Obsidian 核心图片上传插件。它能自动扫描当前笔记中的本地图片，安全上传至 S3 兼容的云存储（如 Cloudflare R2、AWS S3、MinIO 等），并自动将笔记中的本地链接无缝替换为公共云端 URL。

## 快速上手

1. 安装插件，打开 **设置 → S3 Image Sync Pro**
2. 在 **第一步：连接云存储** 中选择服务商（推荐 Cloudflare R2）
3. 填写凭据，点击 **测试连接** 验证
4. 打开一篇有本地图片的笔记，点击左侧栏的云图标 — 搞定！

## ✨ 核心功能 (Features)

**🔥 五大杀手锏特性 (Pro 独享)**
1. ⚡ **WebP 高级压缩**：内置强大的 WebP WebAssembly 编码引擎，在上传前将臃肿的截图极速压缩，大幅节省 S3 流量和存储成本，实现图片“秒开”。
2. 🗂️ **基于笔记路径归类**：新增 `{notedir}` 和 `{notename}` 变量，让云端附件完美映射本地 Obsidian 的树形目录结构，告别图床文件杂乱无章。
3. 🗑️ **删除联动清理**：当您在本地删除笔记或废弃图片时，插件会在后台自动从 S3 云端抹除对应的文件，彻底消灭“幽灵附件”。
4. 🌐 **网络图片自动转存**：检测到笔记中的外部网络图片（如 Web Clipper 剪藏）时，后台自动下载、WebP 压缩并转存至您的 S3 图床，无缝替换链接，不产生任何本地临时文件。
5. 🔄 **S3 路径智能跟随**：在 Obsidian 中移动或重命名笔记时，云端 S3 中的对应图片会自动“搬家”到新路径，保持云端图床与本地知识库 100% 同步。

**🛠️ 更多强大功能**
- **S3 兼容存储**：原生支持 Cloudflare R2（推荐）、AWS S3、MinIO 及任意兼容服务。
- **移动端完美适配**：全功能支持桌面端与移动端，专为手机设计的优雅响应式 UI。
- **现代画廊扫描视图**：提供类似相册的懒加载预览和流畅的操作控件，轻松批量管理本地图片。
- **极致的安全与容错**：原子性文件写入避免并发覆盖；上传失败自动回滚；网络波动时支持指数退避重试（最多重试 3 次）。
- **智能代码块感知**：自动忽略代码块（code blocks）中的图片链接，防止误改代码。

## 配置说明

### 第一步：连接您的云存储

选择您的存储服务商并填写凭据：

| 配置项 | 描述 |
|-------|-------------|
| **存储服务商** | Cloudflare R2（推荐）、AWS S3、MinIO 或自定义 S3 |
| **端点 URL** | 您的存储终结点，例如 `https://abc123.r2.cloudflarestorage.com` |
| **上传路径模板** | 强烈推荐：`{notedir}/{notename}/{filename}-{hash-short}.{ext}` |

#### 上传路径模板变量

通过**上传路径模板**来自定义图片在云存储中的保存路径（S3 Object Key）。Pro 版新增支持以下动态变量：

- `{notedir}`：当前笔记所在的相对目录路径（例如 `工作/项目A`）。
- `{notename}`：当前笔记的文件名（不含后缀，例如 `会议记录`）。
- `{ext}`：文件扩展名/后缀。
- `{hash}` / `{hash-short}`：文件特征哈希值。
- `{filename}`：原始文件名 (不含扩展名)。

*示例：* `images/{notedir}/{notename}/{filename}-{hash-short}.{ext}` 将会在云端生成类似 `images/工作/项目A/会议记录/图1-a1b2c3d4.webp` 这种极度整洁且人类可读的完美路径！

### 第二步：高级处理与清理策略

- **开启 WebP 压缩**：强烈建议开启。您可以拖动滑块寻找体积与画质的完美平衡点。
- **开启云端删除联动**：开启后，当插件监听到本地有图片或笔记被删除时，会自动将之前上传的云端 S3 文件一并丢入垃圾桶，做到彻彻底底的清理！

## 致敬与鸣谢

本项目基于 [jongchoiyip](https://github.com/jongchoiyip) 的优秀开源项目 [s3-image-sync](https://github.com/jongchoiyip/s3-image-sync) 进行深度重构与功能扩展。在此向原作者表达最诚挚的敬意与感谢，正是因为有了他打下的坚实基础，才有了如今强大易用的 Pro 版本！

## 许可证

MIT
