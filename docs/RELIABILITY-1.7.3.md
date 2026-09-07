# 1.7.3 reliability changes and follow-up plan

## Scope

This patch implements the first reliability phase. It does not change the user's processing directories, clean up cloud objects, merge the proposed Excalidraw integration, or imply that every vault/storage/mobile combination has been tested.

### Changes

1. **One syntax contract:** local/Wiki and remote Markdown parsing feeds uploads, reference protection, audits and path changes. Split fragments before decoding, decode destinations once, handle balanced parentheses and retain titles and aliases when replacing a destination.
2. **Exact writes:** inside `Vault.process`, reparse current content and apply replacements from the end of the document. Raw-link maps are matched against parsed spans, never against arbitrary text or URL substrings. Code examples and comments remain intact.
3. **Durable work:** record a pending path before executing background work. Observation snapshots are not acknowledgements. Failure and partial remote transfer retain pending work. Per-note in-flight tasks are coalesced; a revision changed during work prevents stale completion. Eligible failures retry with one-minute-to-one-hour backoff; restart catch-up still respects its user setting.
4. **Settings:** directory rules are drafts until explicitly applied; validation failure leaves the active rules unchanged. This is validation and explicit application, not yet a full scope-preview UI. Existing legacy/policy modes are preserved.
5. **Compatibility:** `getLanguage()` requires 1.8.7. The new manifest, README and compatibility entry use that minimum, with a release-validation guard. Old tags/assets are not rewritten to conceal past compatibility claims.
6. **Lifecycle:** unloading marks the instance disposed, stops scheduled work and closes normal mutation guards. This does not abort a network request already sent, nor promise rollback of a completed external request.

## Validation

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run verify-release` and `npm run build`.

`tests/reliability.test.cjs` covers encoded characters, parentheses, titles, current-document exact replacement, code/comment protection, failed work across simulated restart, concurrent work, newer revisions, partial failures, unload and invalid directory rules. It invokes actual plugin methods with mocked Vault/storage boundaries: this is not a real Obsidian end-to-end test or a cloud deletion test.

Before broad deployment, use a disposable test vault and bucket for network loss, upload-response loss, rename during upload, folder moves, shared images, ignore/verify paths, same-key different content, mobile WebP and reload during work. Never test deletion against production data without an explicit reviewed inventory.

## Remaining work, in priority order

- Introduce a unified operation preview and result panel, conflict handling for mirror downloads, cancellation checkpoints and configuration snapshots across every bulk command.
- Separate background local-image adoption from the default display-link mode through an explicit, backwards-compatible settings migration.
- Replace whole-vault startup reads where safe with incremental indexes; add prefix/directory audits, bounded concurrency and report export. Preserve fresh complete reference checks before deletion.
- The existing 20,000-path load cap remains. A larger durable queue needs bounded, recoverable storage and explicit overflow behavior before changing this guard; this release must not be advertised as lossless for arbitrarily large pending queues.
- Excalidraw needs a complete adapter for parsing, upload, download, toggle, audit and deletion protection. A bare-URL upload patch alone is insufficient. Reference-style Markdown, indented code blocks and arbitrary plugin formats still need broader syntax coverage.
- Keep R2/unknown-provider automatic physical deletion disabled until required conditional semantics are documented and independently tested. Unreferenced does not mean safe to delete.
- Audit historical 1.6.0–1.6.4 releases against original commits and asset manifests before repairing missing tags/compatibility entries. Do not point historical tags at current master.
- Confirm public upstream-author permission/contributor attribution under the community directory's fork policy; no authorization evidence is invented by this patch.
- Development dependency audit (2026-09-07): updated both `brace-expansion` instances within existing constraints to remove the reported high-severity DoS advisories. One moderate advisory remains for esbuild 0.20's development HTTP server; this project uses build/watch, not `serve`, and esbuild is not bundled into the plugin. Upgrade the build tool in a separately verified change; do not use `npm audit fix --force` blindly.

## Publishing checklist

- Default English README and Chinese guide agree with settings defaults, API minimums, network/account requirements and destructive-operation boundaries.
- CI and release artifacts are built from the same reviewed commit. Version/tag/manifest/compatibility metadata match.
- Use the community directory's **Review branch** preview before release where account access is available, then inspect the new release's actual review result. A GitHub Actions pass is not a community-review pass.
- Preserve the original license and verify fork permission separately from the MIT license.

Sources: [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [developer policies](https://docs.obsidian.md/community-directory/developer-policies), [community review controls](https://docs.obsidian.md/community-directory/manage-entry), [public API definitions](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts).

## 中文摘要

本次完成基础可靠性修复，不扩大处理目录，不触碰云端数据。修复链接误替换与特殊字符解析，持久记录后台失败任务，增加同篇去重和新修改保护，目录规则改为校验后手动应用，最低 Obsidian 版本纠正为 1.8.7。

测试包含真实插件方法配合模拟边界，不等同于真实 Obsidian、R2/S3、手机端实测。尚未实现：完整任务面板、下载冲突预览、大库增量校对、完整 CommonMark/Excalidraw 适配、超大待处理队列重构。历史版本缺口、上游公开授权和开发依赖审计单独核实，不能靠改标签或跳过检查掩盖问题。
