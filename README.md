# S3 Image Sync Pro

[中文说明](#中文说明)

**S3 Image Sync Pro** is a polished, modern, and mobile-friendly Obsidian plugin that scans local note images, uploads them to your S3-compatible cloud storage (Cloudflare R2, AWS S3, MinIO, etc.), and replaces local Markdown links with remote public URLs safely.

---

> 📢 **Pro Version Enhancements**
>
> This Pro version has been deeply refactored and supercharged with **3 killer features** over traditional image sync plugins:
> 
> 1. ⚡ **WebP WASM Advanced Compression**: Integrated with a powerful local WebP WebAssembly encoder. Automatically compress heavy screenshots/photos (JPEG/PNG) into modern, lightweight WebP format *before* uploading, drastically saving your S3 storage costs and boosting note loading speeds.
> 2. 🗂️ **Note-Path Based Organization**: Keep your cloud bucket organized just like your vault! Use the `{notedir}` and `{notename}` variables in your upload path template to automatically mirror your Obsidian folder structure into your S3 bucket.
> 3. 🗑️ **Two-Way Delete Sync**: No more "ghost attachments" eating up your cloud quota! When you delete a note or an image inside Obsidian, the plugin detects the deletion and safely removes the corresponding file from your S3 bucket in the background.
> 4. 🌐 **Remote Image Auto-Transfer**: Automatically detect, download, compress, and re-upload external web images (e.g., from Web Clipper) to your S3 bucket in the background. No local files generated!
> 5. 🔄 **S3 Path Auto-Sync**: When you move or rename a note in Obsidian, its associated S3 images are automatically moved to match the new path, keeping your cloud bucket perfectly aligned with your vault structure.

---

## Quick Start

1. Install the plugin and open **Settings → S3 Image Sync Pro**
2. Under **Step 1: Connect your cloud storage**, choose a provider (Cloudflare R2 recommended)
3. Fill in your credentials and click **Test connection**
4. Open a note containing local images and click the cloud icon in the left ribbon — done!

## Features

- **S3-compatible storage**: Cloudflare R2 (recommended), AWS S3, MinIO, or any S3-compatible provider.
- **WebP Compression**: Configurable image compression (Quality settings & optional resize) powered by embedded WASM.
- **Smart Delete Sync**: Keeps your cloud storage clean by automatically syncing local deletions to the cloud.
- **Cross-Platform Responsive**: Fully functional on both Obsidian desktop and mobile, optimized with custom viewport CSS rules.
- **Modern Gallery View**: Browse local images easily with lazy-loading previews and smooth selection controls.
- **Safe Replacement & Rollback**: Atomic note writes with concurrent-edit detection; failed uploads are automatically rolled back.
- **Upload Resilience**: 3 retries with exponential backoff on transient network failures.
- **Delete Policies**: Ask before delete, immediate trash, or delayed delete (desktop only).
- **Auto Scan**: Periodic vault-wide scanning with quiet-period and image size filtering (desktop only).

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

## License

MIT

---

## 中文说明

**S3 Image Sync Pro** 是一款优雅、轻量且对移动端深度优化的 Obsidian 核心图片上传插件。它能自动扫描当前笔记中的本地图片，安全上传至 S3 兼容的云存储（如 Cloudflare R2、AWS S3、MinIO 等），并自动将笔记中的本地链接无缝替换为公共云端 URL。

---

> 📢 **Pro 版五大核心新特性**
>
> 相比传统的图床插件，Pro 版深入痛点进行了重构，带来了五大杀手锏级别的能力：
> 
> 1. ⚡ **WebP 高级压缩**：内置了强大的 WebP WebAssembly 编码引擎。在上传云端之前，插件能在本地极速将臃肿的截图/照片（JPEG/PNG）压缩为现代的 WebP 格式。大幅节省您的 S3 流量和存储成本，让笔记里的图片做到“秒开”体验！
> 2. 🗂️ **基于笔记路径自动归类**：告别云端存储桶里数万张图片乱作一团的窘境！路径模板新增了 `{notedir}`（笔记所在目录）和 `{notename}`（笔记名）变量，让您的云端附件也能像本地一样按照笔记的树形目录结构自动归类，一目了然！
> 3. 🗑️ **删除同步云端清理**：当您在 Obsidian 中删除了某个废弃的笔记，或者删除了某张错传的图片时，插件会聪明地监听到删除事件，并在后台批量从 S3/R2 云端彻底抹除对应的图片文件，彻底告别“幽灵附件”不断侵蚀云端容量的烦恼！
> 4. 🌐 **网络图片自动转存**：当检测到笔记中包含外部网络图片（如使用 Web Clipper 剪藏的内容）时，插件会在后台自动将其下载、WebP 压缩并转存至您的 S3 图床，然后无缝替换笔记中的链接。纯内存处理，不产生任何本地临时文件！
> 5. 🔄 **S3 路径智能跟随**：在 Obsidian 中移动或重命名笔记时，云端 S3 中的对应图片会自动“搬家”到新路径下，并自动更新笔记内的所有链接。让您的云端图床结构始终与本地知识库保持 100% 同步！

---

## 快速上手

1. 安装插件，打开 **设置 → S3 Image Sync Pro**
2. 在 **第一步：连接云存储** 中选择服务商（推荐 Cloudflare R2）
3. 填写凭据，点击 **测试连接** 验证
4. 打开一篇有本地图片的笔记，点击左侧栏的云图标 — 搞定！

## 核心功能

- **WebP 本地无感压缩**: 纯本地 WASM 运算，极速瘦身，支持自定义压缩质量。
- **笔记目录结构映射**: 支持将 Obsidian 的文件夹路径直接映射到云端存储桶路径中。
- **云端垃圾自动清理**: 本地删除文件后，云端联动删除，保持云端存储桶清爽。
- **S3 兼容存储**: 支持 Cloudflare R2、AWS S3、MinIO 及任意 S3 兼容服务。
- **移动端兼容**: 桌面端和移动端均可使用，移动端也拥有优雅、独立的响应式布局。
- **现代画廊视图**: 通过懒加载预览和流畅的选择控件，轻松浏览本地图片。
- **安全替换 & 自动回退**: 原子性文件写入，检测并发编辑；上传中途失败时自动删除已上传文件并回滚。
- **代码块感知**: 智能忽略 fenced code block 和行内代码中的图片。

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

## 许可证

MIT
