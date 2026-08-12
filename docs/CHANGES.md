# 历史变更纪要与架构演进 (CHANGES)

本文件用于记录重大的系统重构、踩坑解决记录以及核心功能上线的重大里程碑，以便接手人员追溯系统演进历史。

## 2026-07-23 (v1.2.3 - v1.2.6): WebP 完全支持与兼容性硬核修复

**背景**：为了在不增加用户配置和本地依赖的情况下实现极致的高清截图 WebP 自动压缩，引入了 `@jsquash/webp` (基于 WASM)。但随即引发了一系列隐蔽、崩溃级的问题。经过连续攻坚，彻底修补。

### 核心演进点
1. **彻底攻克了 Obsidian WebAssembly 兼容黑洞**：修复了 `Invalid URL` 的崩溃，通过修改 esbuild 配置对 `import.meta.url` 进行了沙盒底层欺骗与兜底，使得原生的 WASM 能在不降级、不改源码的情况下无缝加载运行。
2. **根除了由于 S3 / Cloudflare R2 Hash 校验导致的 `XAmzContentSHA256Mismatch` 幽灵错误**：这是极其底层且难以排查的问题（由 Electron 的跨进程 ArrayBuffer 序列化以及 WASM 共享内存试图导致）。最终放弃修改内存拷贝，而是采用 AWS 官方协议允许的 `UNSIGNED-PAYLOAD` 特权指令直接绕开服务端的内容签名校验，大幅提高传输速度，再无任何序列化传输截断导致的校验错误。
3. **修复了中文路径外链的破损 (Double Encoding)**：清理了 Markdown 链接拼接逻辑中多余的 `encodeURI`。
4. **用户工作流提效**：去除了原先不必要的“本地图片保存路径”约束配置（因为一切均走向了粘贴截图全自动压缩与无缝云同步，旧时代的约束不再适用）。

**结论**：`s3-image-sync-pro` 现已进入稳定支持 WebP 并且具备最高级别 R2 传输稳定性的版本阶段。

## 2026-08-11 (v1.6.5): canonical cloud/local mirror paths

- Unified package, manifest, lockfile, and compatibility-map version numbers at 1.6.5.
- The local mirror now always follows the exact S3 object key, including when Cloud link mode is selected.
- Cloud downloads, link toggles, startup checks, and re-sync use the same canonical path rule.
- Added configurable ignored note paths for bulk actions.
- Re-sync now preserves source cloud objects while copying to the canonical key.
- Rewrote the README with the actual ribbon actions, safety behavior, and migration workflow.

## 2026-08-11 (v1.6.6): Obsidian source-code compliance

- Typed the bundled WebP WASM import as Uint8Array and removed unsafe access.
- Removed the unnecessary ArrayBuffer assertion and completion console log.
- Startup path checks now validate both the note directory and note-name segment.

## 2026-08-12 (v1.6.7): path-sync ownership boundary

- Added configurable S3 key prefixes excluded from note-path synchronization.
- Defaulted the exclusion to `mpclipper` so shared-domain images managed by MpClipper Sync are not moved or reported as mismatches.
- Kept excluded-prefix images available for cloud display, local-mirror download, and local/cloud link switching.
- Fixed note-rename synchronization incorrectly parsing an already-extracted S3 key as a full URL, and preserved both cloud and local link modes during rewrites.
