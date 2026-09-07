# 1.8.0 — safe mirror restore

## Problem and change

The previous bulk cloud-to-local command compared bytes but overwrote an existing mirror when they differed. It also used live settings across awaits, counted failures without per-object results, and had no cancellation. Local-link lookup could substitute another extension with the same basename.

The command now opens a read-only preview. Actual cloud bodies are SHA-256 hashed, checked against metadata when present, and compared with local bytes. Only missing local files are eligible for an explicit restore. Conflicts and identical files are preserved. Exact key/extension lookup replaces extension guessing.

## Execution contract

- The preview reads eligible `staging`/`managed` Markdown references, deduplicates keys, and uses the current storage identity's recognized prefixes. `verify` and `ignore` do not become writable.
- Configured S3 connection fields are copied for the operation. Connection, mirror-root, recognition or directory-policy changes stop further work. The comparison snapshot includes sensitive fields **only in memory**; reports contain no configuration or raw error responses.
- Each restore re-fetches the cloud body and requires the preview hash to still match. It checks local absence, reserves the plugin's key lock and rereads a still-eligible original note reference before writing, including after parent-folder creation.
- `vault.createBinary` is the only file-writing primitive in this restore adapter. It never calls `modifyBinary`, deletes or renames existing files. An existing destination is treated as a failure/change, not permission to overwrite. Post-write bytes are read and hashed.
- Invalid or ambiguous cross-platform paths (including traversal segments, backslashes, reserved Windows device names and trailing dots/spaces) fail explicitly. A key is not silently sanitized into another key.
- Cancel, close, unload, disabling and changed configuration stop work at checkpoints. Already dispatched network requests/writes cannot be aborted through this API. Completed files are retained; no automatic rollback/deletion is attempted. Empty parent folders may remain if interrupted after their creation.
- The dialog prevents duplicate download dialogs for the same plugin instance. Reports show all entries through 50-row pagination. Confirmation applies to all missing entries. The optional clipboard report includes private note paths, keys, hashes and status codes. It is not automatically persisted.

## Costs and limitations

Preview downloads full referenced cloud objects; restore fetches missing objects a second time. Traffic and provider charges apply. Execution is serial and does not retain all image bodies, but one large image still needs memory for its body/hash/readback. All reference/result records are held in memory; this is not the planned large-vault incremental index.

The command restores current referenced keys; it does not rename cloud objects to note paths, upload local conflicts, overwrite existing mirrors, rewrite Markdown or back up unreferenced bucket contents. Preview failure/cancellation before completion requires a new preview; the partial preview is not persisted. Cancellation during restore preserves available per-entry results while the window remains open. Missing statuses in a stopped report mean not completed, not successful.

Filesystem writes and note changes made by other plugins/processes cannot be made globally transactional by this plugin. References are rechecked as late as practical, and this command uses create-only writes. Another writer can still change a note/file after those checks or after final verification. Do not mistake this for a filesystem-wide lock or continuous integrity monitor.

Only this command has the new preview/cancellation/configuration snapshot flow. Other bulk commands, persistent queue segmentation, incremental audits and full Excalidraw integration remain future work. The existing 20,000-record queue cap and deletion-provider restrictions are unchanged. The development-only esbuild server advisory remains tracked in the 1.7.3 reliability document.

## Validation

`tests/mirror-download.test.cjs` tests Chinese/special-character paths, traversal and Windows aliases, missing/identical/conflicting content, missing cloud objects, invalid metadata, safe error categories, changed cloud/local data, cancellation, failed creates and post-write verification. It also invokes the actual plugin adapter with mocked vault/S3 ports to check scope exclusion, reference changes, configuration changes, changes during parent creation, unloaded plugins, key-lock release and exact-extension lookup.

The suite does not operate on a user's real vault or bucket. Desktop/mobile UI, live S3 provider responses and community directory approval must not be inferred from unit tests or GitHub CI.

Community rules are checked with the official ESLint rules, TypeScript, metadata validation and reproducible release build workflow. See [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) and [release review process](https://docs.obsidian.md/community-directory/manage-entry). A published release triggers a directory scan, but only the directory's own result establishes approval.
