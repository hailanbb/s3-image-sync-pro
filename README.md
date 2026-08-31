# S3 Image Sync Pro

[![GitHub release](https://img.shields.io/github/v/release/hailanbb/s3-image-sync-pro?display_name=tag&sort=semver)](https://github.com/hailanbb/s3-image-sync-pro/releases/latest)
[![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A5%201.6.6-7C3AED)](https://obsidian.md/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Keep Markdown image links, a local mirror inside your vault, and S3-compatible cloud objects aligned.

[Chinese guide](README.zh-CN.md) · [Latest release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest) · [Report an issue](https://github.com/hailanbb/s3-image-sync-pro/issues) · [Architecture changes](docs/CHANGES.md)

This guide describes version **1.7.2**. It starts with the safest beginner setup, then explains directory policies, link modes, note moves, deletion safeguards, audits, and troubleshooting.

## What the plugin does

S3 Image Sync Pro manages three related forms of each supported image:

1. The image link written in a Markdown note.
2. A local mirror file stored inside the vault.
3. An object stored in Cloudflare R2, AWS S3, MinIO, or another S3-compatible service.

Its central path rule is:

```text
cloud object key
  = path relative to the local mirror root
  = image path associated with the note
```

For example, with a local mirror root of `98 cloudflareR2`:

```text
Note:
06 Archive/Projects/Example.md

Cloud object key:
06 Archive/Projects/Example/photo.webp

Local mirror:
98 cloudflareR2/06 Archive/Projects/Example/photo.webp
```

The selected link mode changes only the link written in Markdown. A successful upload always keeps the exact local mirror, including when the default link mode is **Cloud**.

## Main features

- Upload pasted, dropped, scanned, or externally created local images.
- Keep a local mirror whose relative path matches the cloud object key.
- Write either a public cloud URL or a local mirror path into Markdown.
- Apply different behavior to different vault directories.
- Catch up notes created or changed while the app was closed.
- Move managed cloud paths when a managed note moves.
- Download cloud images into the local mirror through signed S3 requests.
- Switch supported links between Cloud and Local modes.
- Run quick or deep read-only consistency audits.
- Protect external object-key prefixes managed by other tools.
- Queue narrowly verified AWS S3 deletions behind an optional grace period.

## Important safety facts

Read these points before using the plugin on an existing vault:

- Back up the vault and important cloud data first.
- Start with all remote-deletion switches turned off.
- Use **Quick consistency audit** before any path migration.
- The `ignore` and `verify` directory modes do not rewrite notes or move objects.
- A cloud URL can render in a note only if the browser can read it. Signed plugin downloads do not make a private object publicly displayable.
- Cloudflare R2, MinIO, and custom providers preserve remote objects during automatic cleanup. The plugin does not assume they support the same atomic conditional-delete behavior as AWS S3.
- An unreferenced object is not automatically proof that the object is safe to delete.
- HTML, Base64 data, and application-specific embedded formats such as Excalidraw internals are outside the normal Markdown image-reference safety scan.

## Requirements

- Obsidian 1.6.6 or later.
- An S3-compatible bucket and credentials if cloud features are used.
- A browser-readable public URL or custom domain if notes should display Cloud links directly.
- Desktop or mobile is supported by the manifest, but test provider-specific behavior on your devices before relying on automation.

No separate user account is required by this plugin. It connects directly to the storage service configured by the user.

## Installation

### Install from the community directory

After the current release is accepted into the community directory:

1. Open **Settings → Community plugins**.
2. Search for **S3 Image Sync Pro**.
3. Select **Install**, then **Enable**.

### Install manually

1. Open the [latest GitHub release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest).
2. Download `main.js`, `manifest.json`, and `styles.css`.
3. Create this folder inside the vault:

   ```text
   <vault>/.obsidian/plugins/s-three-image-sync-pro/
   ```

4. Put the three downloaded files in that folder.
5. Restart Obsidian and enable **S3 Image Sync Pro** under **Community plugins**.

Do not copy `data.json` between people or publish it. That file can contain storage credentials and private configuration.

## Upgrade safely

1. Disable the plugin or close Obsidian.
2. Back up the installed plugin folder, especially `data.json`.
3. Replace only `main.js`, `manifest.json`, and `styles.css` with files from the new release.
4. Keep the existing `data.json`.
5. Restart Obsidian and confirm the displayed plugin version.
6. Review the directory policies and both remote-cleanup switches.
7. Run a quick consistency audit before a large migration.

## First-time setup

Open **Settings → S3 Image Sync Pro** and configure the following groups.

### 1. Storage provider

Choose one of:

- Cloudflare R2
- AWS S3
- MinIO
- Custom S3-compatible service

Enter the endpoint, region, bucket name, access key ID, and secret access key required by that provider.

Use credentials with only the permissions needed for the chosen features. A typical configuration needs object read, write, head, and list permissions. AWS S3 cleanup additionally needs narrowly scoped delete permission.

### 2. Public URL or custom domain

The plugin uses S3 credentials for background API operations. Markdown Cloud links, however, are loaded by the preview renderer like ordinary web images.

Configure a public URL prefix or custom domain if you want Cloud links to display directly. If the bucket is private, use Local link mode for display or provide a browser-readable delivery layer that matches your security requirements.

### 3. Local mirror directory

The default is:

```text
98 cloudflareR2
```

This directory is inside the vault. Do not place it inside a managed note directory. Add an `ignore` policy for the mirror root so mirror files are not treated as notes to process.

### 4. Default link mode

- **Cloud** writes the configured cloud URL into Markdown after upload.
- **Local** writes the local mirror path into Markdown.

Both modes still create or preserve the cloud object and exact local mirror after a successful upload.

### 5. Directory scope

New installations should use **Directory policies**. Legacy exclusion mode remains available for older configurations.

## Directory policies

Add one rule per line:

```text
staging: 01 Inbox
managed: 06 Archive
managed: 07 Work
verify: 04 Wiki
ignore: 03 Backup
ignore: 98 cloudflareR2
```

The longest matching path wins. Unmatched paths are ignored.

### `staging`

Use this for temporary inboxes and incoming material.

- Uploads and link switching are allowed.
- Local mirrors are maintained.
- Existing cloud paths are not automatically migrated to a new note-derived path.
- A later move into `managed` can establish the final canonical path.

### `managed`

Use this for stable, long-lived notes.

- Uploads and link switching are allowed.
- Local mirrors are maintained.
- The expected cloud key follows the managed note path.
- Note moves can trigger transactional path migration.

### `verify`

Use this for content that should participate in audits without automatic mutation.

- References are inspected.
- Notes, links, mirrors, and cloud objects are not automatically changed.
- Referenced objects remain protected from orphan classification.

### `ignore`

Use this for folders the plugin must not process.

- No upload, rewrite, download, or path migration is performed for notes in the directory.
- Supported references are still treated conservatively during global safety checks so a referenced object is not casually deleted.

## Recommended workflow

A safe knowledge-management layout is:

```text
01 Inbox          -> staging
03 Backup         -> ignore
04 Wiki           -> verify
06 Archive        -> managed
07 Work           -> managed
98 cloudflareR2   -> ignore
```

This arrangement lets temporary content arrive without aggressive path movement. When another plugin, script, or agent moves a finished note into a managed directory, S3 Image Sync Pro can make the cloud and mirror paths follow the note.

## How images are processed

### Pasting or dropping an image

For an eligible note, the plugin:

1. Reads the incoming image bytes.
2. Optionally converts a supported format to WebP.
3. Calculates the final upload hash.
4. Chooses a cloud key from the note path and path template.
5. Refuses to overwrite a conflicting existing object.
6. Uploads with a unique operation identifier.
7. Reads back metadata to verify ownership and content.
8. Writes the exact local mirror.
9. Replaces the placeholder with the configured Cloud or Local link.

### Images created by another plugin, script, or agent

When Cloud mode is active, the plugin can adopt supported ordinary local image links after the note becomes stable. It uploads the image, creates the mirror, and rewrites the link only when the note is eligible under the directory policy.

Files created while Obsidian is closed are handled by the persistent startup catch-up queue when that feature is enabled. Failed items remain queued for a later run instead of being silently forgotten.

### Moving a note

Behavior depends on the source and destination policies:

- A move within temporary or ignored areas does not imply a managed cloud migration.
- A move into `managed` establishes the expected note-derived key.
- Managed migration reads the old object, checks the target for collision, creates the target without overwriting, verifies the mirror, then rewrites the note.
- Optional cleanup of the old AWS S3 object is a separate delayed operation.

### Deleting a note

Deleting a note is different from moving it.

- The local mirror is not blindly removed by folder prefix.
- The cloud object is not immediately deleted.
- Remote deletion remains off unless the user enables the dedicated setting.
- Eligible AWS S3 objects enter a grace-period queue only when exact ownership data is available.
- Before deletion, the plugin performs a fresh whole-vault reference check and creates a verified recovery copy.
- If the operation becomes ambiguous or a new reference appears, the object is preserved or restored.

Keep cloud versioning or an independent backup for important buckets even when these safeguards are enabled.

## Ribbon cloud menu

Select the cloud icon in the left ribbon to access the main operations.

### Scan current document images

Find supported local or remote images in the active Markdown note and process only candidates allowed by its directory policy.

### Switch image links

Switch supported links in the current note or selected scope between Cloud and Local modes. Switching to Cloud first confirms that the cloud object exists or uploads an eligible local source; it does not merely replace text with an unverified URL.

### Download cloud images to the local mirror

Read supported cloud objects through authenticated S3 GET requests and write them under the exact relative key inside the configured mirror root. This is useful before changing the default display mode to Local.

### Re-sync all S3 image paths

This is a mutation command for managed notes. It compares each recognized link with the key expected from the current note path, then performs the safe migration sequence.

Run a quick audit first. Do not use re-sync as a generic orphan cleaner.

### Quick consistency audit

This read-only check compares:

- recognized note references;
- local mirror files;
- all objects returned by the configured bucket listing.

It reports path mismatches, missing cloud objects, missing mirrors, size mismatches, local-only files, cloud-only objects, protected objects, and entries that cannot be fully verified.

### Deep consistency audit

Deep audit adds SHA-256 verification for supported referenced mirrors and cloud objects that carry compatible plugin-written hash metadata. It is slower and downloads more data, so use it periodically or while investigating a discrepancy.

## Reading audit results

| Result | Meaning | Recommended action |
| --- | --- | --- |
| Path mismatch | A managed note references a recognized key that differs from the key derived from its current path | Inspect the note and both keys, then use re-sync if the target is correct |
| Missing cloud | The note references a recognized cloud key that is not present | Restore from a verified mirror or backup; do not rewrite blindly |
| Missing local | A referenced object exists but the exact mirror is absent | Use the download-to-mirror command |
| Size mismatch | Cloud metadata and mirror size disagree | Run deep audit and compare backups |
| Hash mismatch | Available hashes disagree | Stop automatic replacement and choose the authoritative copy manually |
| Local orphan | A mirror file has no supported note reference | Review before moving or deleting it |
| Cloud orphan | A listed cloud object has no supported note reference | Review external consumers and backups; this is not deletion authorization |
| Protected | A policy or protected prefix excludes the object from mutation | Leave it under the owning workflow |
| Unverified | Available metadata is insufficient for a strong conclusion | Use deep audit or manual inspection |

## Protected cloud-key prefixes

Some tools store images in the same bucket but own their own paths. Add one object-key prefix per line under **Cloud key prefixes excluded from path sync**, for example:

```text
mpclipper
external-app/assets
```

The plugin can still recognize these URLs for display-oriented operations, but it does not move or automatically delete objects under protected prefixes.

## WebP conversion

WebP conversion is optional.

- Quality is configurable.
- Formats listed under **Skip formats** are preserved.
- The upload hash is calculated from the final bytes, after conversion.
- If conversion fails, the plugin reports the failure instead of claiming that an unverified upload succeeded.

Test screenshots, diagrams with transparency, and photographs at the chosen quality before enabling conversion for a large workflow.

## Troubleshooting

### A Cloud link does not display

1. Open the URL in a browser.
2. Confirm that the public URL prefix maps to the configured bucket and object key.
3. Check whether the object is private or blocked by delivery rules.
4. Confirm that the URL is not an old prefix belonging to another bucket identity.
5. Switch the note to Local mode if public browser access is not intended.

### Switching to Cloud has no effect

Check that:

- the note matches `staging` or `managed`;
- the plugin master switch is enabled;
- credentials and bucket settings are complete;
- the local source is a supported image;
- the source is not under an ignored path;
- the target cloud key does not contain conflicting content.

### Download to mirror completes but Local mode is broken

Compare the cloud object key with the path below the local mirror root. They must be identical after URL decoding and path normalization. Run a quick audit to identify missing or mismatched mirrors.

### Startup reports mismatched notes

The notice means managed notes contain recognized image keys that differ from their current note-derived paths. It can be caused by older releases, moves performed while the plugin was disabled, or links created by another tool. Run a quick audit first and inspect the listed source and expected keys before re-syncing.

### `NoSuchKey` appears during migration

The note refers to an old key that is no longer present at that exact location. Do not assume the object is lost: search the audit result, local mirror, historical URL prefixes, and backups for the same filename or content. Restore or copy the verified bytes to the expected key before rewriting the note.

### Another tool's objects appear as orphans

Add that tool's stable object-key prefix to the protected-prefix setting. Do not use a broad prefix that also covers objects owned by this plugin.

### Excalidraw images are not uploaded

The standard scanner handles supported Markdown image references. It does not guarantee support for image references stored inside Excalidraw's internal document data. Track this limitation in the project's GitHub issues before relying on it.

## Network, privacy, and security disclosure

The plugin performs network requests only for user-configured storage operations and user-requested remote image transfers. Depending on the enabled action, this can include S3-compatible `PUT`, `GET`, `HEAD`, `LIST`, copy, or delete requests and downloads from image URLs already present in notes.

- Credentials are stored in the plugin's local `data.json` inside the vault configuration directory.
- The project does not include client-side telemetry, advertising, analytics, or a developer-operated cloud service.
- The plugin does not install or update itself.
- Storage credentials and note URLs can reveal private infrastructure details. Never attach `data.json` to a public issue.
- Use least-privilege bucket credentials and rotate credentials if they are exposed.

## What the plugin intentionally does not do

- It is not a general two-way folder synchronization service.
- It does not treat every bucket object as owned by the plugin.
- It does not recursively delete a cloud folder when a vault folder disappears.
- It does not make private objects public.
- It does not guarantee support for arbitrary HTML, Base64, canvas, Excalidraw-internal, or proprietary embedded image formats.
- It does not replace cloud versioning, backups, or an independent disaster-recovery plan.

## Development

Requirements: Node.js 24 or later and npm.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run verify-release
npm run build
```

The lint command includes the official `eslint-plugin-obsidianmd` recommended rules used to catch community-review issues locally. Release validation also checks that:

- `package.json`, `package-lock.json`, and `manifest.json` use the same version;
- `versions.json` maps that plugin version to the declared minimum app version;
- a release tag exactly matches the manifest version;
- the manifest description is short, ends with a period, and does not repeat the host application's name.

GitHub Actions runs tests, type checking, official lint rules, metadata validation, and a production build on pushes and pull requests. A version tag repeats those checks, creates artifact attestations, and publishes `main.js`, `manifest.json`, and `styles.css`.

## Version notes

| Version | Summary |
| --- | --- |
| 1.7.2 | Complete English community README with the detailed Chinese manual preserved separately |
| 1.7.1 | Community-review source fixes and official review lint rules in local development and CI |
| 1.7.0 | Directory policies, startup catch-up, signed downloads, transactional path migration, delayed deletion safeguards, and three-way audits |
| 1.6.9 | Local-mirror adoption, exact-key uploads, verified Cloud switching, and background handling of external note writes |
| 1.5.5 | Historical tag and release restored for version-history completeness |

Always install from the [latest release](https://github.com/hailanbb/s3-image-sync-pro/releases/latest). See [docs/CHANGES.md](docs/CHANGES.md) for the technical history.

## License and attribution

S3 Image Sync Pro is released under the [MIT License](LICENSE). It is based on and extends [jongchoiyip/s3-image-sync](https://github.com/jongchoiyip/s3-image-sync).

For the complete Chinese beginner manual, including detailed Cloudflare R2 examples and the vault workflow used by the maintainer, read [README.zh-CN.md](README.zh-CN.md).
