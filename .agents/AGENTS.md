# s3-image-sync-pro 项目 AI 协作规则手册

> 本文件是专为 AI 智能体和开发者准备的硬性约束和防坑指南。在本项目中修改代码或调试 Bug 之前，**必须阅读本文件**。

## 1. 核心架构与技术栈约束
- **环境**：Obsidian 插件环境，底层为 Electron (Chromium + Node.js)。
- **语言**：TypeScript 编写，使用 `esbuild` 打包成单个 `main.js` (CJS 格式)。
- **禁止使用原生 Node API**：如果在核心业务逻辑（尤其是网络和文件处理）中能用 Obsidian API（如 `requestUrl`, `app.vault.adapter`），请勿使用 `fs` 或 `http/https` 原生模块，以保证最佳的跨平台和沙盒兼容性。

## 2. 踩坑警示与防崩溃铁律（CRITICAL）

### 2.1 WASM 打包与 WebP 的 `import.meta.url` 坑
**现象**：加载 `@jsquash/webp` 或其他含有底层文件回退探测代码的 WASM 库时，在 Web 端或 Node 端正常，但在 Obsidian 内报 `Failed to construct 'URL': Invalid URL`。
**原因**：第三方库为了探测 `.wasm` 会执行 `new URL("xxx.wasm", import.meta.url)`。由于 `esbuild` 默认会把 `import.meta.url` 转换为一个未定义的空对象属性或保留为空，导致 `new URL` 接收不到绝对基准路径而崩溃。
**防范规则**：
- 在 `esbuild.config.mjs` 的 `define` 中强制注入合法的协议头兜底，例如：`define: { "import.meta.url": "'app://obsidian.md/'" }`。
- 切勿在 `main.ts` 中直接 `import` 被 Node 原生重度污染的库。

### 2.2 S3 XAmzContentSHA256Mismatch 与 Electron IPC 序列化坑
**现象**：当传输由 WASM 处理返回的二进制图片数据（WebP），或从 `SharedArrayBuffer` 转换来的底层数据时，向 Cloudflare R2 / S3 发起 PUT 请求，服务端一直拒绝并报错 `XAmzContentSHA256Mismatch`。但这对于普通的 `image/png` 原生 ArrayBuffer 却不发生。
**原因**：`requestUrl` API 底层通过 Electron IPC 进程间通信发送。由于某些 WASM 派生的 `ArrayBuffer`（如共享视图或特殊分配），在经过结构化克隆（Structured Clone）传递给主进程发网络请求时，可能会遭遇极细微的截断或克隆破损。这导致 S3 服务端接收到的正文，与我们在客户端测算得到的 `SHA-256` 不匹配。
**防范规则**：
1. **纯净数据隔离**：在传递复杂衍生 Buffer 前，通过 `const safeBody = new Uint8Array(body.length); safeBody.set(body);` 深拷贝成绝对平凡的 V8 内存对象。
2. **免检通行证（推荐方案）**：在 HTTP S3 V4 签名中，对于受信任的 HTTPS 连接，直接将头部 `x-amz-content-sha256` 及 Canonical Request 中对应的 Hash 值设为 `"UNSIGNED-PAYLOAD"`。这可以彻底绕过这种幽灵内存校验错误！

### 2.3 URL 双重编码坑 (Double Encoding)
**现象**：中文或带空格的图片上传成功，但由于 Markdown 替换的图片链接 `404` 导致裂开。
**原因**：在构造 S3 key 对应的 `publicUrl` 过程中，往往已经执行过 `encodeURIComponent()`；如果在最终拼成 `![img](url)` 的时候再多做一次 `encodeURI(url)`，就会导致 `%E4` 被套娃编码成 `%25E4`。
**防范规则**：对于生成外链的替换逻辑，确保全链路只进行 **一次** 有效 URL 编码。
