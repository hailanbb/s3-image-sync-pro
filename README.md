# S3 Image Sync Pro

[中文说明](#中文说明)

**S3 Image Sync Pro** is a polished, modern, and mobile-friendly Obsidian plugin that scans local note images, uploads them to your S3-compatible cloud storage (Cloudflare R2, AWS S3, MinIO, etc.), and provides a revolutionary **Dual-Copy Architecture** to keep local and cloud assets perfectly synchronized.

## ✨ Features

**🔥 6 Killer Pro Enhancements**
1. ⚡ **WebP WASM Compression**: Embedded local WebP encoder compresses heavy screenshots into modern, lightweight formats *before* uploading, drastically saving costs and boosting load speeds.
2. 🗂️ **Dual-Copy Architecture & Link Toggle**: Images are saved to both a local mirror directory and your S3 bucket. A powerful advanced command lets you toggle image links between "Local Mirror" and "Cloud URL" seamlessly across a single note or your entire vault.
3. 🧲 **Cloud-to-Local Migration Tool**: Got historical notes with cloud-only images? Use the one-click migration command to download all cloud images back to your local mirror directory, bringing old notes into the dual-copy ecosystem.
4. 🗑️ **Two-Way Delete Sync**: When you delete a note or image inside Obsidian, the plugin safely removes the corresponding file from S3 *and* cleans up the local mirror directory in the background. No more "ghost attachments"!
5. 🌐 **Remote Image Auto-Transfer**: Automatically detect, download, compress, and re-upload external web images (e.g., from Web Clipper) to S3 in the background. No local temp files generated!
6. 🔄 **Path Auto-Sync**: When you move or rename a note, its associated S3 images and local mirror directories are automatically moved to match the new path, keeping everything perfectly aligned with your vault.

**🛠️ More Powerful Features**
- **S3-Compatible Storage**: Works seamlessly with Cloudflare R2 (recommended), AWS S3, MinIO, or any S3-compatible provider.
- **Cross-Platform**: Fully functional on both Obsidian desktop and mobile with optimized, responsive UI.
- **Modern Gallery View**: Browse local images easily with lazy-loading previews and smooth selection controls.
- **Safe Replacement & Resilience**: Atomic note writes prevent concurrent-edit corruption; failed uploads auto-rollback; built-in exponential backoff for network failures.
- **Smart Parsing**: Intelligently ignores images inside fenced code blocks and inline code.

## 🚀 Advanced Commands

The plugin provides several advanced commands in the Obsidian Command Palette (`Ctrl/Cmd + P`):

- **`S3 Image Sync Pro: Toggle image links (local ↔ cloud)`**
  Popups a dialog allowing you to switch all image links from local paths to cloud URLs (or vice versa). You can apply this to the **Current note only** or **All notes in vault**. This is incredibly useful when publishing notes or sharing vaults.
- **`S3 Image Sync Pro: Download all cloud images to local mirror`**
  Scans your entire vault for cloud URLs and downloads them to your local mirror directory, ensuring your vault has a complete offline backup of all images.

## 📖 Scenario Guides

**Scenario 1: Adopting the Plugin Mid-Way (Existing Local Images)**
If you've been using Obsidian for a while and have a vault full of old local images (e.g., in an `assets/` folder), you don't need to manually migrate them!
**Guide**: After configuring the plugin, simply click the Cloud icon in the ribbon and select **"Scan vault images without replacing"** (or use the equivalent command in the palette). The plugin will automatically upload all your old local attachments to S3, generate clean new copies in the mirror directory (e.g., `98 cloudflareR2`), seamlessly update all the links in your notes, and **safely move the old, scattered images to your system trash**. A painless, one-click migration to the cloud!

**Scenario 2: Fresh Install & Restoring Notes on a New Computer**
When you switch to a new computer, install Obsidian and this plugin, and sync your text notes via a third-party tool (like Git or a cloud drive), you might panic noticing your local image mirror directory is missing.
**Guide**: Don't worry! Even if your notes only contain cloud links or broken local paths, simply click the ribbon menu and select **"Download all cloud images to local mirror"**. The plugin will scan all links in your vault and smartly fetch every original image from S3 back to your new computer, perfectly rebuilding the `98 cloudflareR2` directory structure. Your dual-copy architecture is instantly restored!

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
| **Upload path template** | Default: `{notedir}/{notename}/{hash-short}.{ext}` |

Click **Test connection** to verify your settings.

### Step 2: Advanced Settings

- **Local mirror directory**: Choose where to store the local copy of your images (default: `98 cloudflareR2`).
- **Default link mode**: Choose whether new uploads should default to injecting a local path or a cloud URL into your notes.
- **WebP Compression**: Enable to automatically encode uploaded images to WebP. 
- **Cloud Delete Sync**: Enable to auto-trash corresponding S3 images when you delete a note or an image inside Obsidian.

## Acknowledgments

This project is a heavily refactored and enhanced fork of the excellent [s3-image-sync](https://github.com/jongchoiyip/s3-image-sync) by [jongchoiyip](https://github.com/jongchoiyip). A huge thanks and profound respect to the original author for laying the incredible foundation that made this Pro version possible!

## License

MIT

---

## 中文说明

**S3 Image Sync Pro** 是一款优雅、轻量且对移动端深度优化的 Obsidian 核心图片上传插件。它提供革命性的**双副本架构（Dual-Copy Architecture）**，在将图片上传至 S3 兼容云存储（如 Cloudflare R2）的同时，在本地保持完美的镜像副本，让您兼得云端的便携与本地的安心。

## ✨ 核心功能 (Features)

**🔥 六大杀手锏特性 (Pro 独享)**
1. ⚡ **WebP 高级压缩**：内置强大的 WebP WebAssembly 编码引擎，在上传前将臃肿的截图极速压缩，大幅节省 S3 流量和存储成本，实现图片“秒开”。
2. 🗂️ **双副本架构与一键切换**：图片会自动在本地镜像目录和云端 S3 各保存一份。借助强大的高级命令，您可以随时在“本地路径”与“云端 URL”之间无缝切换图片链接，支持单篇笔记或全库批量操作。
3. 🧲 **云端到本地一键迁移**：历史笔记里的图片只在云端没有本地备份？使用一键迁移命令，插件会扫描全库，将所有云端图片下载回本地镜像目录，让旧笔记也能享受双副本的安全感。
4. 🗑️ **删除联动清理**：当您在本地删除笔记或废弃图片时，插件会在后台自动从 S3 云端抹除对应的文件，**并同步清理本地镜像目录**，彻底消灭“幽灵附件”。
5. 🌐 **网络图片自动转存**：检测到笔记中的外部网络图片（如 Web Clipper 剪藏）时，后台自动下载、WebP 压缩并转存至您的 S3 图床，无缝替换链接，不产生任何本地临时垃圾文件。
6. 🔄 **路径智能跟随**：在 Obsidian 中移动或重命名笔记时，云端 S3 中的对应图片以及本地的镜像目录会自动“搬家”到新路径，保持云端与本地知识库 100% 同步。

**🛠️ 更多强大功能**
- **S3 兼容存储**：原生支持 Cloudflare R2（推荐）、AWS S3、MinIO 及任意兼容服务。
- **移动端完美适配**：全功能支持桌面端与移动端，专为手机设计的优雅响应式 UI。
- **现代画廊扫描视图**：提供类似相册的懒加载预览和流畅的操作控件，轻松批量管理本地图片。
- **极致的安全与容错**：原子性文件写入避免并发覆盖；上传失败自动回滚；网络波动时支持指数退避重试（最多重试 3 次）。
- **智能代码块感知**：自动忽略代码块（code blocks）中的图片链接，防止误改代码。

## 🚀 高级命令 (Advanced Commands)

在 Obsidian 的命令面板（`Ctrl/Cmd + P`）中输入 `S3 Image Sync Pro` 即可调用：

- **`S3 Image Sync Pro: 切换图片链接（本地 ↔ 云端）`**
  弹出一个确认窗口，允许您将图片链接在“本地镜像”和“云端公共链接”之间互相切换。您可以选择只对**当前笔记**生效，或者直接对**全库所有笔记**生效。这在您准备发布博客、分享 Vault 或进行离线阅读时非常有用。
- **`S3 Image Sync Pro: 一键下载云端图片至本地镜像`**
  扫描全库所有的云端图片链接，并自动多线程下载到您的本地镜像目录，路径结构与云端完全对齐，确保您在断网时依然拥有完整的图片库。

## 📖 场景用法指南 (Scenario Guides)

**场景一：老用户中途接入（已有大量本地图片）**
如果您已经使用 Obsidian 一段时间，库里堆积了大量原本的本地图片（如存放在 `assets/` 下），无需手动一张张搬运！
**指南**：配置好插件后，只需点击左侧栏云朵图标，选择 **“扫描全库图片替换”**。插件会自动将所有旧的本地附件上传到 S3、在镜像目录（如 `98 cloudflareR2`）生成全新的规范副本、把所有旧链接无缝替换掉，并**自动把原先散乱的旧图片移入回收站**。真正做到一键“洗库”与无痛上云！

**场景二：在新设备上全新安装并恢复笔记**
当您换了一台新电脑，全新安装了 Obsidian 和本插件，并通过第三方同步工具（如 Git 或坚果云）只恢复了纯文本的 `.md` 笔记，此时您的本地没有图片镜像，可能会慌。
**指南**：完全不用担心！笔记虽然只包含云端链接或本地路径链接，您只需点击侧边栏菜单中的 **“一键下载云端图片至本地镜像”**，插件会扫描全库的所有链接，并聪明地将 S3 上的图片原封不动地全部“拉回”您的新电脑，完美重建 `98 cloudflareR2` 镜像目录。顷刻间，双副本架构满血复活！

## 配置说明

### 第一步：连接您的云存储

选择您的存储服务商并填写凭据：

| 配置项 | 描述 |
|-------|-------------|
| **存储服务商** | Cloudflare R2（推荐）、AWS S3、MinIO 或自定义 S3 |
| **端点 URL** | 您的存储终结点，例如 `https://abc123.r2.cloudflarestorage.com` |
| **公共访问 URL** | 访问文件的前缀，例如 `https://pub-xxx.r2.dev` |
| **上传路径模板** | 强烈推荐：`{notedir}/{notename}/{filename}-{hash-short}.{ext}` |

点击 **测试连接** 验证。

### 第二步：高级处理与清理策略

- **本地镜像目录**：指定用于保存图片本地副本的 Vault 文件夹（默认：`98 cloudflareR2`）。
- **默认链接模式**：控制新上传/粘贴图片时，笔记中默认插入本地路径还是云端链接。
- **开启 WebP 压缩**：强烈建议开启。您可以拖动滑块寻找体积与画质的完美平衡点。
- **开启云端删除联动**：开启后，当插件监听到本地有图片或笔记被删除时，会自动将云端及本地镜像丢入垃圾桶，做到彻彻底底的清理！

## 致敬与鸣谢

本项目基于 [jongchoiyip](https://github.com/jongchoiyip) 的优秀开源项目 [s3-image-sync](https://github.com/jongchoiyip/s3-image-sync) 进行深度重构与功能扩展。在此向原作者表达最诚挚的敬意与感谢，正是因为有了他打下的坚实基础，才有了如今强大易用的 Pro 版本！

## 许可证

MIT
