# S3 Image Sync Pro

[![Version](https://img.shields.io/badge/version-1.6.7-blue)](https://github.com/hailanbb/s3-image-sync-pro/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

[English](#english) | [中文](#中文)

<a id="english"></a>

S3 Image Sync Pro is an Obsidian plugin for S3-compatible image storage (Cloudflare R2, AWS S3, MinIO, and compatible services).

## What v1.6.7 guarantees

The plugin maintains one path invariant:

```text
S3 object key == local mirror path relative to the mirror directory
```

For example, an object at `Projects/Example/image.webp` is mirrored locally at
`98 cloudflareR2/Projects/Example/image.webp`.

This remains true even when the default link mode is **Cloud**. Link mode changes only the Markdown link inserted into a note; it never changes where the local mirror is written. Therefore, after using **Download all cloud images to local mirror**, switching links between Cloud and Local remains reliable.

## Features

- Upload images to S3-compatible storage and keep a local mirror.
- Use Cloud URL or Local Mirror links independently of storage layout.
- Download cloud-linked images back to the exact local mirror path.
- Move/rename sync that copies objects to their canonical new key without deleting the previous object.
- Configurable ignored note paths for every bulk operation.
- Optional WebP compression before upload.
- Retry and rollback protection for failed cloud operations.
- Remote image transfer and code-block-aware Markdown parsing.

## Cloud ribbon menu

The cloud icon in Obsidian's left ribbon provides:

1. **Scan current note images** — upload images referenced by the active note.
2. **Scan vault images without replacing** — preview candidate local images across the vault; it does not rewrite links.
3. **Toggle image links** — switch Cloud/Local links for the current note or vault.
4. **Download all cloud images to local mirror** — download each cloud object to its canonical mirror path.
5. **Re-sync all S3 image paths** — repair cloud keys after notes are moved or renamed, while retaining old cloud objects as a safety measure.

Ignored paths are respected by bulk scans, downloads, toggles, startup checks, and re-sync.

## Recommended workflow

1. Set the S3/R2 endpoint, bucket, credentials, public URL, and local mirror directory.
2. Set an upload path template that follows your note structure, for example:
   `{notedir}/{notename}/{hash-short}.{ext}`.
3. Add folders that should not be processed in **Ignored note paths**.
4. Use Cloud links when sharing notes online; use Local links for offline viewing.
5. On a new device, run **Download all cloud images to local mirror** before switching to Local links.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into `<vault>/.obsidian/plugins/s-three-image-sync-pro/`.
3. Enable the plugin in **Settings → Community plugins**.

## Development

```bash
npm install
npm run build
```

The production build bundles the required WebP WASM assets into `main.js`.

## License

MIT. This project is based on and extends [s3-image-sync](https://github.com/jongchoiyip/s3-image-sync).

---

<a id="中文"></a>

# 中文

S3 Image Sync Pro 是用于 Cloudflare R2、AWS S3、MinIO 等 S3 兼容对象存储的 Obsidian 图片同步插件。

## v1.6.7 的路径规则

插件始终遵守同一条规则：

```text
云端 S3 对象键 = 本地镜像目录下的相对路径
```

例如，云端对象键为 `Projects/Example/image.webp` 时，本地镜像必定保存为
`98 cloudflareR2/Projects/Example/image.webp`。

即使默认链接模式设置为“云端”，插件也会写入这份本地镜像。链接模式只决定笔记中使用云端 URL 还是本地链接，不会改变图片保存位置。因此，执行“下载云端图片至本地镜像”后，随时切换为本地链接都能保持路径匹配。

## 小云朵菜单

- **扫描当前笔记图片**：上传当前笔记引用的本地图片。
- **扫描全库图片但不替换**：仅预览全库中可处理的本地图片，不改写笔记链接。
- **切换图片链接**：在当前笔记或全库范围内切换“云端 / 本地”链接。
- **下载云端图片至本地镜像**：按云端对象键的原路径下载到本地镜像。
- **重新同步全部 S3 图片路径**：在笔记被移动或重命名后，补齐新的规范云端路径，并保留旧对象作为安全备份。

“忽略的笔记路径”会在全库扫描、下载、切换、启动检查和重新同步中统一生效。

## 推荐使用顺序

1. 配置存储端点、Bucket、凭据、公开访问 URL 与本地镜像目录。
2. 使用与笔记结构对应的上传模板，例如 `{notedir}/{notename}/{hash-short}.{ext}`。
3. 在“忽略的笔记路径”中填写不希望插件处理的目录。
4. 需要在线分享时使用云端链接；离线浏览时切换为本地链接。
5. 在新设备上，先执行“下载云端图片至本地镜像”，再切换为本地链接。

## 安装

从最新 Release 下载 `main.js`、`manifest.json` 和 `styles.css`，复制到
`<vault>/.obsidian/plugins/s-three-image-sync-pro/`，然后在 Obsidian 的“设置 → 第三方插件”中启用。

## 开发

```bash
npm install
npm run build
```

生产构建会将 WebP 所需的 WASM 资源打包进 `main.js`。
