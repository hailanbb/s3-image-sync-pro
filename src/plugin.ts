import { Notice, Platform, Plugin, TFile, TFolder, getLanguage, Editor, MarkdownView, MarkdownFileInfo, requestUrl, Menu } from "obsidian";
import {
  Candidate,
  LocalFileRecord,
  LocalRef,
  LogEntry,
  NoteSyncSnapshot,
  PendingDeleteRecord,
  PluginSettings,
  ProgressState,
  RemoteCandidate,
  ReplaceResult,
  ScanOptions,
  S3Config,
  UploadResult,
} from "./types";
import { DEFAULT_SETTINGS, getReplacementForExt, mergeSettings } from "./settings";
import { extractLocalRefs, extractRemoteImageRefs, guessExtFromUrl } from "./link-parser";
import {
  putS3Object,
  deleteS3Object,
  getS3Object,
  headS3Object,
  isPutOwnershipConfirmed,
  listS3ObjectsV2,
  supportsAtomicConditionalDelete,
} from "./s3-client";
import { sha256Hex } from "./crypto";
import {
  buildPublicUrl,
  buildCanonicalNoteKey,
  buildLinkReplacement,
  buildStorageIdentity,
  cloudKeyFromRecognizedUrl,
  cloudKeyFromLocalMirrorPath,
  cloudUrlPrefixesForStorage,
  contentTypeForExt,
  escapeMarkdownLabel,
  normalizeCloudUrlPrefix,
  normalizeRecognizedCloudDomains,
  renderPathTemplate,
  replaceAllLiteral,
  safeFilename,
  trimSlashes,
  usesCanonicalNotePathTemplate,
} from "./utils";
import { detectLocaleFromApp, t as translate } from "./i18n";
import { CandidateModal } from "./candidate-modal";
import { DryRunModal } from "./dry-run-modal";
import { compressToWebp } from "./image-compressor";
import { S3ImageSyncSettingTab } from "./settings-tab";
import { LinkToggleModal } from "./link-toggle-modal";
import { canAudit, canCheckPath, canMutate, canPathSync, getPathMode, PathMode } from "./path-policy";
import {
  auditConsistency,
  CloudObjectRecord,
  LocalObjectRecord,
  NoteObjectReference,
  ProtectionObjectReference,
} from "./consistency-audit";
import { ConsistencyAuditModal } from "./consistency-modal";
import {
  areReferenceSnapshotsEqual,
  isDeletePathModeAuthorized,
  isExactObjectVersion,
  isOwnedVersionEligible,
  ReferenceSnapshotEntry,
} from "./deletion-safety";
import { SerializedAsyncQueue } from "./serialized-async-queue";

interface PathMigrationContext {
  s3: S3Config;
  mirrorRoot: string;
  storageIdentity: string;
  targetNotePath: string;
  pathTemplate: string;
}

interface PreparedPathMigration {
  createdTarget: boolean;
  contentSha256: string;
  size: number;
  operationId: string | null;
  etag: string | null;
}

interface FreshReferenceMap {
  references: Map<string, Set<string>>;
  complete: boolean;
  generation: number;
  recognitionIdentity: string;
  snapshot: ReferenceSnapshotEntry[];
}

type PendingDeleteOutcome = "deleted" | "preserved" | "deferred";

export default class S3ImageSyncPlugin extends Plugin {
  declare settings: PluginSettings;
  locale!: string;
  autoScanTimer: number | null = null;
  isMobile: boolean = false;
  private noteRemoteUrls: Map<string, string[]> = new Map();
  private deleteQueueTimer: number | null = null;
  private startupTimer: number | null = null;
  private runtimeInitialized = false;
  private runtimeInitializing = false;
  private noteChangeGeneration = 0;
  private deleteProcessing = false;
  private keyOperations = new Set<string>();
  private startupCatchupQueue = new Map<string, TFile>();
  private startupCatchupRun: Promise<void> | null = null;
  private settingsSaveQueue = new SerializedAsyncQueue();

  async onload(): Promise<void> {
    await this.loadSettings();
    if (this.rememberCloudUrlPrefix(this.getCloudUrlPrefix())) {
      await this.saveSettings();
    }
    this.locale = detectLocaleFromApp(getLanguage);
    this.isMobile = Platform.isMobile;

    this.addRibbonIcon("upload-cloud", this.t("ribbonScan"), (evt: MouseEvent) => {
      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandScanCurrent"))
          .setIcon("upload-cloud")
          .onClick(() => {
            void this.scanCurrentNote();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandScanVault"))
          .setIcon("folder-sync")
          .onClick(() => {
            void this.scanVaultDryRun();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandToggleLinks"))
          .setIcon("switch")
          .onClick(() => {
            new LinkToggleModal(this.app, this).open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandDownloadToLocal"))
          .setIcon("download-cloud")
          .onClick(() => {
            void this.downloadCloudToLocal();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandResyncPaths"))
          .setIcon("refresh-cw")
          .onClick(() => {
            void this.resyncAllS3Paths();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandQuickAudit"))
          .setIcon("list-checks")
          .onClick(() => {
            void this.runConsistencyAudit(false);
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(this.t("commandProcessDeletes"))
          .setIcon("trash-2")
          .onClick(() => {
            void this.processPendingDeletes(true);
          })
      );

      menu.showAtMouseEvent(evt);
    });

    this.addCommand({
      id: "scan-current-note",
      name: this.t("commandScanCurrent"),
      callback: () => this.scanCurrentNote(),
    });

    this.addCommand({
      id: "scan-vault-candidates-dry-run",
      name: this.t("commandScanVault"),
      callback: () => this.scanVaultDryRun(),
    });

    this.addCommand({
      id: "toggle-link-mode",
      name: this.t("commandToggleLinks"),
      callback: () => new LinkToggleModal(this.app, this).open(),
    });

    this.addCommand({
      id: "download-cloud-to-local",
      name: this.t("commandDownloadToLocal"),
      callback: () => this.downloadCloudToLocal(),
    });

    this.addCommand({
      id: "resync-all-s3-paths",
      name: this.t("commandResyncPaths"),
      callback: () => this.resyncAllS3Paths(),
    });

    this.addCommand({
      id: "quick-consistency-audit",
      name: this.t("commandQuickAudit"),
      callback: () => this.runConsistencyAudit(false),
    });

    this.addCommand({
      id: "deep-consistency-audit",
      name: this.t("commandDeepAudit"),
      callback: () => this.runConsistencyAudit(true),
    });

    this.addCommand({
      id: "process-delayed-image-deletes",
      name: this.t("commandProcessDeletes"),
      callback: () => this.processPendingDeletes(true),
    });

    this.addSettingTab(new S3ImageSyncSettingTab(this.app, this));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.noteChangeGeneration++;
          if (!this.runtimeInitialized) return;
          void this.handleNoteDelete(file.path);
        } else if (file instanceof TFolder) {
          this.noteChangeGeneration++;
          if (!this.runtimeInitialized) return;
          void this.handleFolderDelete(file.path);
        }
      })
    );
    // Paste and Drop event listeners
    this.registerEvent(
      this.app.workspace.on("editor-paste", this.onEditorPaste.bind(this) as (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => void)
    );
    this.registerEvent(
      this.app.workspace.on("editor-drop", this.onEditorDrop.bind(this) as (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => void)
    );
    this.configureAutoScan();
    this.configureAutoRemoteTransfer();
    // Sync S3 paths when note is moved/renamed
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
        this.noteChangeGeneration++;
        if (!this.runtimeInitialized) return;
        if (file instanceof TFolder) {
          void this.handleFolderRename(file).catch((error: unknown) => {
            this.addLog({ status: "folder-path-sync-failed", notePath: file.path, sourcePath: oldPath, remoteUrl: "" });
            new Notice(this.t("s3PathSyncFailed", {
              error: error instanceof Error ? error.message : String(error),
            }));
          });
          return;
        }
        if (file.extension !== "md") return;
        const cachedKeys = this.noteRemoteUrls.get(oldPath);
        if (cachedKeys) {
          this.noteRemoteUrls.delete(oldPath);
          this.noteRemoteUrls.set(file.path, cachedKeys);
        }
        const oldSnapshot = this.settings.noteSyncIndex[oldPath];
        if (oldSnapshot) {
          delete this.settings.noteSyncIndex[oldPath];
          this.settings.noteSyncIndex[file.path] = oldSnapshot;
        }
        if (this.settings.startupCatchupPendingPaths.includes(oldPath)) {
          this.settings.startupCatchupPendingPaths = this.settings.startupCatchupPendingPaths
            .filter((path) => path !== oldPath && path !== file.path);
          this.settings.startupCatchupPendingPaths.push(file.path);
        }
        this.cancelPendingDeleteForPath(oldPath);
        void this.cacheRemoteUrls(file);
        if (
          this.settings.enabled &&
          this.settings.syncS3OnNoteMove &&
          canPathSync(this.getNotePathMode(file.path))
        ) {
          void this.syncS3PathsOnRename(file, oldPath).catch((error: unknown) => {
            this.addLog({ status: "note-path-sync-failed", notePath: file.path, sourcePath: oldPath, remoteUrl: "" });
            new Notice(this.t("s3PathSyncFailed", {
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        } else if (this.settings.enabled) {
          this.scheduleBackgroundImageSync(file);
        }
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.startupTimer = window.setTimeout(() => {
        this.startupTimer = null;
        void this.initializeRuntimeState();
      }, 3000);
    });
  }

  onunload(): void {
    if (this.autoScanTimer) window.clearInterval(this.autoScanTimer);
    if (this.deleteQueueTimer) window.clearInterval(this.deleteQueueTimer);
    if (this.startupTimer) window.clearTimeout(this.startupTimer);
    if (this.settingsSaveTimer) window.clearTimeout(this.settingsSaveTimer);
    for (const timer of this.remoteTransferDebounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.remoteTransferDebounceTimers.clear();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Record<string, unknown> | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, loaded || {});
  }

  async saveSettings(): Promise<void> {
    await this.settingsSaveQueue.enqueue(async () => {
      // Snapshot only when this write reaches the head of the queue. This
      // prevents an older save from landing after a persisted inFlight marker.
      const toSave = JSON.parse(JSON.stringify({
        ...this.settings,
        logs: this.settings.logs.slice(0, 50),
      })) as Record<string, unknown>;
      await this.saveData(toSave);
    });
  }

  t(key: string, params: Record<string, unknown> = {}): string {
    return translate(this.locale, key, params);
  }

  isIgnoredNotePath(path: string): boolean {
    return !canMutate(this.getNotePathMode(path));
  }

  isIgnoredNote(file: TFile | null | undefined): boolean {
    return !!file && this.isIgnoredNotePath(file.path);
  }

  getNotePathMode(path: string): PathMode {
    return getPathMode(path, this.settings);
  }

  private isAuditedNotePath(path: string): boolean {
    return canAudit(this.getNotePathMode(path));
  }

  private isExcludedFromPathSync(cloudKey: string): boolean {
    const key = trimSlashes(cloudKey.replace(/\\/g, "/"));
    return this.settings.excludedPathSyncKeyPrefixes.some((value) => {
      const prefix = trimSlashes(value.replace(/\\/g, "/"));
      return prefix !== "" && (key === prefix || key.startsWith(`${prefix}/`));
    });
  }

  private usesCanonicalNotePathTemplate(): boolean {
    return usesCanonicalNotePathTemplate(this.settings.s3.pathTemplate || "");
  }

  private getCanonicalKeyForNote(cloudKey: string, noteFile: TFile): string | null {
    if (!this.usesCanonicalNotePathTemplate()) return null;
    return buildCanonicalNoteKey(cloudKey, noteFile.parent?.path || "", noteFile.basename);
  }

  private getLocalMirrorPathForCloudKey(
    cloudKey: string,
    configuredMirrorRoot: string = this.settings.localMirrorRoot
  ): string | null {
    const mirrorRoot = trimSlashes(configuredMirrorRoot || "98 cloudflareR2");
    const key = trimSlashes(cloudKey);
    return mirrorRoot && key ? `${mirrorRoot}/${key}` : null;
  }

  getStorageIdentity(
    s3: S3Config = this.settings.s3,
    configuredMirrorRoot: string = this.settings.localMirrorRoot
  ): string {
    return buildStorageIdentity(s3, configuredMirrorRoot);
  }

  private rememberOwnedObjectKey(
    key: string,
    storageIdentity = this.getStorageIdentity(),
    contentSha256?: string,
    size?: number,
    operationId?: string | null,
    etag?: string | null
  ): void {
    const normalized = trimSlashes(key);
    if (!normalized) return;
    const existing = this.settings.ownedObjectKeys.find((record) =>
      record.key === normalized && record.storageIdentity === storageIdentity
    );
    if (existing) {
      if (contentSha256) existing.contentSha256 = contentSha256;
      if (typeof size === "number") existing.size = size;
      if (operationId) existing.operationId = operationId;
      if (etag) existing.etag = etag;
      this.scheduleSettingsSave();
      return;
    }
    this.settings.ownedObjectKeys.push({
      key: normalized,
      storageIdentity,
      contentSha256,
      size,
      operationId: operationId || undefined,
      etag: etag || undefined,
    });
    this.settings.ownedObjectKeys = this.settings.ownedObjectKeys.slice(-20000);
    this.scheduleSettingsSave();
  }

  private reserveKeyOperation(key: string): void {
    if (this.keyOperations.has(key)) throw new Error(`Object is busy: ${key}`);
    this.keyOperations.add(key);
  }

  private releaseKeyOperation(key: string | undefined): void {
    if (key) this.keyOperations.delete(key);
  }

  private postponePendingDeletesForKey(key: string, delayMs = 5 * 60_000): void {
    let changed = false;
    const nextDueAt = Date.now() + delayMs;
    for (const record of this.settings.pendingDeleteQueue) {
      if (record.keys.includes(key) || record.inFlight?.key === key) {
        record.dueAt = Math.max(record.dueAt, nextDueAt);
        changed = true;
      }
    }
    if (changed) this.scheduleSettingsSave();
  }

  private async waitForPersistedNoteReference(
    noteFile: TFile,
    key: string,
    timeoutMs = 30_000
  ): Promise<boolean> {
    const check = async (): Promise<boolean> => {
      const current = this.app.vault.getAbstractFileByPath(noteFile.path);
      if (!(current instanceof TFile) || current.extension !== "md") return false;
      try {
        return this.extractRemoteUrls(await this.app.vault.read(current)).includes(key);
      } catch {
        return false;
      }
    };
    if (await check()) {
      await this.cacheRemoteUrls(noteFile);
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let checking = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.app.vault.offref(eventRef);
        resolve(result);
      };
      const eventRef = this.app.vault.on("modify", (file) => {
        if (settled || checking || file.path !== noteFile.path) return;
        checking = true;
        void check().then(async (found) => {
          checking = false;
          if (!found) return;
          await this.cacheRemoteUrls(noteFile);
          finish(true);
        });
      });
      const timer = window.setTimeout(() => finish(false), timeoutMs);
    });
  }

  configureAutoScan(): void {
    if (this.autoScanTimer) window.clearInterval(this.autoScanTimer);
    this.autoScanTimer = null;
    if (this.isMobile) return;
    if (!this.settings.enabled || !this.settings.autoScanEnabled) return;
    const minutes = Math.max(1, Number(this.settings.scanIntervalMinutes) || 30);
    this.autoScanTimer = window.setInterval(() => {
      this.runAutoScan().catch((error) => {
        new Notice(this.t("autoScanFailed", { error: error instanceof Error ? error.message : String(error) }));
      });
    }, minutes * 60 * 1000);
  }

  async scanCurrentNote(): Promise<void> {
    if (!this.settings.enabled) {
      new Notice(this.t("disabled"));
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice(this.t("openMarkdownFirst"));
      return;
    }
    try {
      this.ensureS3Settings();
    } catch (error: unknown) {
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }
    const candidates = await this.findCandidatesInNote(activeFile, {
      requireAutoCandidate: false,
      enforceAttachmentRoot: false,
      enforceSizeRule: false,
      skipExtensionFilter: true,
      includeLocalMirror: true,
    });
    const remoteCandidates = await this.findRemoteCandidatesInNote(activeFile);
    if (candidates.length === 0 && remoteCandidates.length === 0) {
      new Notice(this.t("noCandidatesEither"));
      return;
    }
    // If we have remote candidates, handle them automatically (no modal needed for remote)
    if (remoteCandidates.length > 0) {
      const notice = new Notice(this.t("remoteImageFound", { count: remoteCandidates.length }), 0);
      try {
        const result = await this.transferRemoteImagesInNote(activeFile, remoteCandidates, (state) => {
          notice.setMessage(`${this.t(state.phase === "downloading" ? "downloading" : state.phase === "uploading" ? "phaseUploading" : state.phase === "rewriting" ? "phaseRewriting" : "phaseDone")} ${state.label} (${state.current}/${state.total})`);
        });
        notice.hide();
        if (result.replaced > 0) {
          new Notice(this.t("remoteTransferNotice", { count: result.replaced }));
        }
      } catch (error) {
        notice.hide();
        new Notice(this.t("downloadFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
    // If we also have local candidates, open the modal for those
    if (candidates.length > 0) {
      new CandidateModal(this.app, this, activeFile, candidates).open();
    }
  }

  async scanVaultDryRun(): Promise<void> {
    if (!this.settings.enabled) {
      new Notice(this.t("disabled"));
      return;
    }
    const files = this.app.vault.getMarkdownFiles();
    let localCount = 0;
    let remoteCount = 0;
    const samples: string[] = [];
    const notice = new Notice(this.t("scanningVault", { current: 0, total: files.length }), 0);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (i % 50 === 0) {
        notice.setMessage(this.t("scanningVault", { current: i, total: files.length }));
      }
      try {
        const candidates = await this.findCandidatesInNote(file, {
          requireAutoCandidate: true,
          enforceAttachmentRoot: true,
          enforceSizeRule: true,
          includeLocalMirror: this.settings.linkMode === "cloud",
        });
        localCount += candidates.length;
        for (const candidate of candidates.slice(0, 2)) {
          if (samples.length < 20) samples.push(`[本地] ${file.path} -> ${candidate.file.path}`);
        }
        const remoteCandidates = await this.findRemoteCandidatesInNote(file);
        remoteCount += remoteCandidates.length;
        for (const rc of remoteCandidates.slice(0, 2)) {
          if (samples.length < 20) samples.push(`[远程] ${file.path} -> ${rc.url}`);
        }
      } catch {
        this.addLog({ status: "dry-run-scan-failed", notePath: file.path, sourcePath: "", remoteUrl: "" });
      }
    }
    notice.hide();
    new DryRunModal(this.app, this, localCount, remoteCount, samples).open();
  }

  async runAutoScan(): Promise<void> {
    if (!this.settings.enabled || !this.settings.autoScanEnabled) return;
    try {
      this.ensureS3Settings();
    } catch {
      return;
    }
    const minBytes = Math.max(0, Number(this.settings.autoScanMinSizeMiB) || 0) * 1024 * 1024;
    const files = this.app.vault.getMarkdownFiles();
    let replaced = 0;
    for (const file of files) {
      try {
        if (!this.isQuiet(file)) continue;
        const candidates = await this.findCandidatesInNote(file, {
          requireAutoCandidate: true,
          enforceAttachmentRoot: true,
          enforceSizeRule: true,
          includeLocalMirror: this.settings.linkMode === "cloud",
        });
        const quietCandidates = candidates.filter((c) => {
          if (!this.isQuiet(c.file)) return false;
          if (minBytes > 0 && c.sizeBytes < minBytes) return false;
          return true;
        });
        if (quietCandidates.length === 0) continue;
        const result = await this.replaceCandidates(file, quietCandidates, null);
        replaced += result.replaced;
      } catch {
        this.addLog({ status: "auto-scan-failed", notePath: file.path, sourcePath: "", remoteUrl: "" });
      }
    }
    if (replaced > 0) new Notice(this.t("autoScanReplaced", { count: replaced }));
  }

  isQuiet(file: TFile): boolean {
    const quietMs = Math.max(0, Number(this.settings.quietSeconds) || 0) * 1000;
    if (!quietMs) return true;
    return Date.now() - file.stat.mtime >= quietMs;
  }

  async findCandidatesInNote(noteFile: TFile, options: ScanOptions): Promise<Candidate[]> {
    if (this.isIgnoredNote(noteFile)) return [];
    const text = await this.app.vault.read(noteFile);
    const refs = extractLocalRefs(text);
    const byKey = new Map<string, Candidate>();

    for (const ref of refs) {
      const targetFile = this.resolveLinkedFile(ref.target, noteFile);
      if (!targetFile || !(targetFile instanceof TFile)) continue;
      const mirrorCloudKey = cloudKeyFromLocalMirrorPath(
        targetFile.path,
        this.settings.localMirrorRoot || "98 cloudflareR2"
      );
      if (mirrorCloudKey && !options.includeLocalMirror) continue;
      if (!mirrorCloudKey && options.enforceAttachmentRoot !== false && !this.isUnderAttachmentRoot(targetFile))
        continue;
      if (this.isCoverReference(text, ref)) continue;

      const ext = targetFile.extension.toLowerCase();
      if (ext === "md") continue;
      if (!options.skipExtensionFilter && !this.settings.enabledExtensions.includes(ext)) continue;
      if (options.requireAutoCandidate && !this.settings.autoCandidateExts.includes(ext))
        continue;
      if (options.enforceSizeRule !== false && !this.meetsSizeRule(targetFile, ext)) continue;

      const replacement = getReplacementForExt(ext, this.settings);
      if (
        mirrorCloudKey &&
        replacement === "image" &&
        ref.kind !== "wiki-embed" &&
        ref.kind !== "markdown-embed"
      ) continue;
      const key = `${targetFile.path}::${replacement}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.refs.push(ref);
        existing.referenceCount += 1;
      } else {
        byKey.set(key, {
          file: targetFile,
          ext,
          replacement,
          refs: [ref],
          referenceCount: 1,
          sizeBytes: targetFile.stat.size,
          mirrorCloudKey: mirrorCloudKey || undefined,
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => b.sizeBytes - a.sizeBytes);
  }

  resolveLinkedFile(target: string, noteFile: TFile): TFile | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      decoded = target;
    }
    const direct = this.app.vault.getAbstractFileByPath(decoded);
    if (direct instanceof TFile) return direct;
    const fromCache = this.app.metadataCache.getFirstLinkpathDest(decoded, noteFile.path);
    if (fromCache instanceof TFile) return fromCache;
    const noteDir = noteFile.parent ? noteFile.parent.path : "";
    const relativePath = noteDir ? `${noteDir}/${decoded}` : decoded;
    const relative = this.app.vault.getAbstractFileByPath(relativePath);
    return relative instanceof TFile ? relative : null;
  }

  isUnderAttachmentRoot(file: TFile): boolean {
    const root = trimSlashes(this.settings.attachmentRoot || "");
    if (!root) return true;
    return file.path === root || file.path.startsWith(`${root}/`);
  }

  isCoverReference(text: string, ref: LocalRef): boolean {
    if (/\/cover\//i.test(ref.target)) return true;
    const fmEnd = text.indexOf("\n---", 4);
    if (fmEnd === -1) return false;
    if (ref.start > fmEnd) return false;
    const lineStart = text.lastIndexOf("\n", ref.start) + 1;
    const lineEndIndex = text.indexOf("\n", ref.end);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const line = text.slice(lineStart, lineEnd);
    return /^\s*cover\s*:/i.test(line);
  }

  meetsSizeRule(file: TFile, ext: string): boolean {
    const minMiB = this.settings.minSizeRules[ext] || 0;
    const minSize = Math.max(0, minMiB) * 1024 * 1024;
    return file.stat.size >= minSize;
  }

  async replaceCandidates(
    noteFile: TFile,
    candidates: Candidate[],
    progress: ((state: ProgressState) => void) | null,
    targetMode: "local" | "cloud" = this.settings.linkMode,
    trashOriginals = this.settings.trashOriginalAfterUpload
  ): Promise<ReplaceResult> {
    if (!this.settings.enabled || !canMutate(this.getNotePathMode(noteFile.path))) {
      throw new Error(this.t("pathNoLongerManaged"));
    }
    this.ensureS3Settings();
    let noteChanged = false;
    let replaced = 0;
    const replacementMap = new Map<string, string>();
    const uploaded = new Map<string, UploadResult>();
    const uniqueFiles = new Set(candidates.map((c) => c.file.path)).size;
    let completedUploads = 0;

    try {
      for (const candidate of candidates) {
        let upload = uploaded.get(candidate.file.path);
        if (!upload) {
          progress?.({
            phase: "uploading",
            current: completedUploads,
            total: uniqueFiles,
            label: candidate.file.name,
          });
          upload = await this.uploadCandidate(candidate, noteFile);
          uploaded.set(candidate.file.path, upload);
          completedUploads += 1;
          progress?.({
            phase: "uploaded",
            current: completedUploads,
            total: uniqueFiles,
            label: candidate.file.name,
          });
        }
        for (const ref of candidate.refs) {
          const targetUrl = (targetMode === "local" && upload.localPath)
            ? upload.localPath.split("/").map(encodeURIComponent).join("/") 
            : upload.publicUrl;
          replacementMap.set(ref.raw, this.buildReplacement(ref, candidate, targetUrl));
        }
      }

      progress?.({
        phase: "rewriting",
        current: completedUploads,
        total: uniqueFiles,
        label: noteFile.name,
      });

      if (!this.settings.enabled || !canMutate(this.getNotePathMode(noteFile.path))) {
        throw new Error(this.t("pathNoLongerManaged"));
      }
      for (const upload of uploaded.values()) {
        if (upload.targetNotePath && upload.targetNotePath !== noteFile.path) {
          throw new Error(this.t("originalLinkChanged", { link: upload.targetNotePath }));
        }
      }

      await this.app.vault.process(noteFile, (current) => {
        let next = current;
        for (const [raw, replacement] of replacementMap.entries()) {
          if (!next.includes(raw)) {
            throw new Error(this.t("originalLinkChanged", { link: raw }));
          }
          next = replaceAllLiteral(next, raw, replacement);
        }
        noteChanged = next !== current;
        return next;
      });
    } finally {
      for (const upload of uploaded.values()) this.releaseKeyOperation(upload.operationLockKey);
    }

    if (!noteChanged) return { replaced: 0 };

    const localFiles = this.buildLocalFileRecords(candidates, uploaded);
    for (const candidate of candidates) replaced += candidate.refs.length;

    if (trashOriginals && localFiles.length > 0) {
      progress?.({
        phase: "trashing",
        current: completedUploads,
        total: uniqueFiles,
        label: this.t("phaseTrashing"),
      });
      await this.deleteLocalFileRecords(noteFile, localFiles, "immediate");
    }

    await this.saveSettings();
    progress?.({
      phase: "done",
      current: uniqueFiles,
      total: uniqueFiles,
      label: this.t("phaseDone"),
    });
    return { replaced, localFiles };
  }

  private async ensureFolderExists(path: string): Promise<void> {
    const folders = path.split("/");
    let current = "";
    for (const folder of folders) {
      if (folder === "") continue;
      current = current === "" ? folder : `${current}/${folder}`;
      const abstractFile = this.app.vault.getAbstractFileByPath(current);
      if (!abstractFile) {
        try {
          await this.app.vault.createFolder(current);
        } catch (e: unknown) {
          if (!(e instanceof Error) || !e.message?.includes("Folder already exists")) throw e;
        }
      }
    }
  }

  private async downloadCloudKeyToMirror(
    cloudKey: string,
    s3Config: S3Config = this.settings.s3,
    mirrorRoot: string = this.settings.localMirrorRoot
  ): Promise<"downloaded" | "unchanged" | "missing"> {
    const localPath = this.getLocalMirrorPathForCloudKey(cloudKey, mirrorRoot);
    if (!localPath) return "missing";
    const response = await getS3Object(s3Config, cloudKey);
    if (!response.exists) return "missing";
    const remoteHash = await sha256Hex(response.body);
    if (response.contentSha256 && response.contentSha256 !== remoteHash) {
      throw new Error(`Cloud object hash verification failed: ${cloudKey}`);
    }
    const parentDir = localPath.substring(0, localPath.lastIndexOf("/"));
    if (parentDir) await this.ensureFolderExists(parentDir);
    const existing = this.app.vault.getAbstractFileByPath(localPath);
    if (existing instanceof TFile && existing.stat.size === response.body.byteLength) {
      const existingHash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(existing)));
      if (existingHash === remoteHash) return "unchanged";
    }
    const binary = response.body.buffer.slice(
      response.body.byteOffset,
      response.body.byteOffset + response.body.byteLength
    );
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, binary);
    } else {
      await this.app.vault.createBinary(localPath, binary);
    }
    const saved = this.app.vault.getAbstractFileByPath(localPath);
    if (!(saved instanceof TFile)) throw new Error(`Local mirror was not created: ${localPath}`);
    const savedHash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(saved)));
    if (savedHash !== remoteHash) throw new Error(`Local mirror hash verification failed: ${localPath}`);
    return "downloaded";
  }

  /** Returns true only when an existing object is byte-for-byte identical. */
  private async readVerifiedCloudObject(
    s3Config: S3Config,
    key: string
  ): Promise<{
    body: Uint8Array;
    hash: string;
    contentType: string | null;
    operationId: string | null;
    etag: string | null;
  } | null> {
    const existing = await getS3Object(s3Config, key);
    if (!existing.exists) return null;
    const hash = await sha256Hex(existing.body);
    if (existing.contentSha256 && existing.contentSha256 !== hash) {
      throw new Error(`Cloud object metadata does not match its bytes: ${key}`);
    }
    return {
      body: existing.body,
      hash,
      contentType: existing.contentType,
      operationId: existing.operationId,
      etag: existing.etag,
    };
  }

  private async verifyExistingCloudObject(
    s3Config: S3Config,
    key: string,
    expectedHash: string
  ): Promise<boolean> {
    const existing = await this.readVerifiedCloudObject(s3Config, key);
    if (!existing) return false;
    if (existing.hash !== expectedHash) {
      throw new Error(`Cloud object collision: ${key}`);
    }
    return true;
  }

  async uploadBuffer(binary: ArrayBuffer, originalName: string, noteFile?: TFile, _originalFilePath?: string): Promise<UploadResult> {
    const s3Snapshot: S3Config = { ...this.settings.s3 };
    const mirrorRootSnapshot = this.settings.localMirrorRoot;
    const storageIdentitySnapshot = this.getStorageIdentity(s3Snapshot, mirrorRootSnapshot);
    const targetNotePath = noteFile?.path;
    const noteDir = noteFile?.parent?.path || "";
    const noteName = noteFile?.basename || "";
    let body = new Uint8Array(binary);
    
    // Attempt to extract extension from filename
    let originalExt = "";
    const parts = originalName.split(".");
    if (parts.length > 1) {
      originalExt = parts.pop()!.toLowerCase();
    }
    
    // If no valid extension found, detect via magic bytes
    if (!originalExt || !["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "heic", "tiff", "ico"].includes(originalExt)) {
      if (body.length >= 4) {
        if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) originalExt = "png";
        else if (body[0] === 0xff && body[1] === 0xd8) originalExt = "jpg";
        else if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) originalExt = "gif";
        else if (body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46) originalExt = "webp";
        else originalExt = "png"; // absolute fallback
      } else {
        originalExt = "png";
      }
    }
    
    let ext = originalExt;
    let contentType = contentTypeForExt(ext);

    // WebP compression (WASM-based, no Canvas API)
    if (
      this.settings.webpEnabled &&
      !this.settings.webpSkipFormats.includes(ext)
    ) {
      try {
        const compressed = await compressToWebp(
          binary,
          ext,
          this.settings.webpQuality
        );
        body = compressed.body;
        ext = compressed.ext;
        contentType = compressed.contentType;
      } catch (error) {
        new Notice(`WebP compression failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // The object key and metadata must describe the bytes actually stored in S3.
    // When WebP is enabled those bytes differ from the original attachment.
    const hash = await sha256Hex(body);

    const key = renderPathTemplate(s3Snapshot.pathTemplate, {
      ext,
      hash,
      hash2: hash.slice(0, 2),
      filename: safeFilename(originalName.replace(/\.[^/.]+$/, "")),
      notedir: noteDir,
      notename: noteName,
    });
    this.reserveKeyOperation(key);
    try {
      const reusedExisting = await this.verifyExistingCloudObject(s3Snapshot, key, hash);
      let ownedByPut = false;
      let ownedVersion: Awaited<ReturnType<S3ImageSyncPlugin["readVerifiedCloudObject"]>> = null;
      if (!reusedExisting) {
        const putResult = await putS3Object(
          s3Snapshot,
          key,
          body,
          contentType,
          (status, text) => this.t("uploadFailed", { status, text }),
          hash,
          { ifNoneMatch: true }
        );
        const uploaded = await this.readVerifiedCloudObject(s3Snapshot, key);
        if (!uploaded || uploaded.hash !== hash) {
          throw new Error(`Uploaded object is missing after verification: ${key}`);
        }
        ownedByPut = isPutOwnershipConfirmed(putResult, uploaded.hash, uploaded.operationId);
        if (ownedByPut) ownedVersion = uploaded;
      }

      if (ownedByPut && ownedVersion) {
        this.rememberOwnedObjectKey(
          key,
          storageIdentitySnapshot,
          hash,
          body.byteLength,
          ownedVersion.operationId,
          ownedVersion.etag
        );
      }
      const publicUrl = buildPublicUrl(s3Snapshot.customDomainName, s3Snapshot.endpoint, s3Snapshot.bucketName, key);
      const localPath = this.getLocalMirrorPathForCloudKey(key, mirrorRootSnapshot);
      if (!localPath) throw new Error("Local mirror root is required for image uploads.");

      {
        const parentDir = localPath.substring(0, localPath.lastIndexOf("/"));
        if (parentDir) {
          await this.ensureFolderExists(parentDir);
        }
        const existing = this.app.vault.getAbstractFileByPath(localPath);
        const mirrorBinary = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        if (existing instanceof TFile) {
          await this.app.vault.modifyBinary(existing, mirrorBinary);
        } else {
          await this.app.vault.createBinary(localPath, mirrorBinary);
        }
        const saved = this.app.vault.getAbstractFileByPath(localPath);
        if (!(saved instanceof TFile)) throw new Error(`Local mirror was not created: ${localPath}`);
        const savedHash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(saved)));
        if (savedHash !== hash) throw new Error(`Local mirror hash verification failed: ${localPath}`);
      }

      return {
        key,
        publicUrl,
        localPath,
        operationLockKey: key,
        targetNotePath,
      };
    } catch (error) {
      // Never delete a cloud object as an immediate rollback. A lost response
      // or concurrent writer makes key-only rollback unsafe; the audit can
      // identify the recoverable orphan later.
      this.releaseKeyOperation(key);
      throw error;
    }
  }

  async uploadCandidate(candidate: Candidate, noteFile?: TFile): Promise<UploadResult> {
    if (candidate.mirrorCloudKey) {
      const s3Snapshot: S3Config = { ...this.settings.s3 };
      const mirrorRootSnapshot = this.settings.localMirrorRoot;
      const storageIdentitySnapshot = this.getStorageIdentity(s3Snapshot, mirrorRootSnapshot);
      const targetNotePath = noteFile?.path;
      const binary = await this.app.vault.readBinary(candidate.file);
      const body = new Uint8Array(binary);
      const hash = await sha256Hex(body);
      const key = trimSlashes(candidate.mirrorCloudKey);
      this.reserveKeyOperation(key);
      try {
        const reusedExisting = await this.verifyExistingCloudObject(s3Snapshot, key, hash);
        let ownedByPut = false;
        let ownedVersion: Awaited<ReturnType<S3ImageSyncPlugin["readVerifiedCloudObject"]>> = null;
        if (!reusedExisting) {
          const putResult = await putS3Object(
            s3Snapshot,
            key,
            body,
            contentTypeForExt(candidate.file.extension.toLowerCase()),
            (status, text) => this.t("uploadFailed", { status, text }),
            hash,
            { ifNoneMatch: true }
          );
          const uploaded = await this.readVerifiedCloudObject(s3Snapshot, key);
          if (!uploaded || uploaded.hash !== hash) {
            throw new Error(`Uploaded object is missing after verification: ${key}`);
          }
          ownedByPut = isPutOwnershipConfirmed(putResult, uploaded.hash, uploaded.operationId);
          if (ownedByPut) ownedVersion = uploaded;
          if (ownedByPut && ownedVersion) {
            this.rememberOwnedObjectKey(
              key,
              storageIdentitySnapshot,
              hash,
              body.byteLength,
              ownedVersion.operationId,
              ownedVersion.etag
            );
          }
        }
        return {
          key,
          publicUrl: buildPublicUrl(
            s3Snapshot.customDomainName,
            s3Snapshot.endpoint,
            s3Snapshot.bucketName,
            key
          ),
          localPath: candidate.file.path,
          operationLockKey: key,
          targetNotePath,
        };
      } catch (error) {
        this.releaseKeyOperation(key);
        throw error;
      }
    }
    const binary = await this.app.vault.readBinary(candidate.file);
    return this.uploadBuffer(binary, candidate.file.name, noteFile, candidate.file.path);
  }

  buildReplacement(ref: LocalRef, candidate: Candidate, publicUrl: string): string {
    return buildLinkReplacement(ref, candidate.replacement, publicUrl);
  }

  buildLocalFileRecords(
    candidates: Candidate[],
    uploaded: Map<string, UploadResult>
  ): LocalFileRecord[] {
    const byPath = new Map<string, LocalFileRecord>();
    for (const candidate of candidates) {
      if (byPath.has(candidate.file.path)) continue;
      const upload = uploaded.get(candidate.file.path);
      // Skip trashing if the original file is already exactly at the mirror path.
      if (upload?.localPath && candidate.file.path === upload.localPath) {
        continue;
      }
      byPath.set(candidate.file.path, {
        path: candidate.file.path,
        name: candidate.file.name,
        remoteUrl: upload?.publicUrl || "",
      });
    }
    return Array.from(byPath.values());
  }

  private async findOtherLocalReferences(
    targetPath: string,
    excludedNotePath: string
  ): Promise<{ notePaths: string[]; complete: boolean }> {
    const notePaths: string[] = [];
    let complete = true;
    for (const note of this.app.vault.getMarkdownFiles()) {
      if (note.path === excludedNotePath) continue;
      try {
        const text = await this.app.vault.read(note);
        const referenced = extractLocalRefs(text).some((ref) =>
          this.resolveLinkedFile(ref.target, note)?.path === targetPath
        );
        if (referenced) notePaths.push(note.path);
      } catch {
        complete = false;
      }
    }
    return { notePaths, complete };
  }

  async deleteLocalFileRecords(
    noteFile: { path: string },
    localFiles: LocalFileRecord[],
    status: string
  ): Promise<void> {
    for (const fileRecord of localFiles) {
      const file = this.app.vault.getAbstractFileByPath(fileRecord.path);
      if (!(file instanceof TFile)) {
        this.addLog({
          status: `${status}-missing-local-file`,
          notePath: noteFile.path,
          sourcePath: fileRecord.path,
          remoteUrl: fileRecord.remoteUrl,
          trashed: false,
        });
        continue;
      }
      const shared = await this.findOtherLocalReferences(file.path, noteFile.path);
      if (!shared.complete || shared.notePaths.length > 0) {
        this.addLog({
          status: shared.complete
            ? `${status}-skipped-shared-local-reference`
            : `${status}-skipped-incomplete-reference-scan`,
          notePath: noteFile.path,
          sourcePath: shared.notePaths.join(", ") || fileRecord.path,
          remoteUrl: fileRecord.remoteUrl,
          trashed: false,
        });
        continue;
      }
      let trashed = false;
      try {
        await this.app.fileManager.trashFile(file);
        trashed = true;
      } catch {
        // Keep the log entry below; the synchronized mirror remains available.
      }
      this.addLog({
        status,
        notePath: noteFile.path,
        sourcePath: fileRecord.path,
        remoteUrl: fileRecord.remoteUrl,
        trashed,
      });
    }
    await this.saveSettings();
  }



  ensureS3Settings(): void {
    const s3 = this.settings.s3;
    const missing: string[] = [];
    for (const key of [
      "endpoint",
      "bucketName",
      "accessKeyId",
      "secretAccessKey",
    ] as const) {
      if (!String(s3[key] || "").trim()) missing.push(key);
    }
    if (s3.provider !== "r2" && !String(s3.region || "").trim()) missing.push("region");
    if (missing.length) throw new Error(this.t("missingS3", { settings: missing.join(", ") }));
  }

  addLog(entry: Omit<LogEntry, "time"> & { time?: string }): void {
    let obj = {
      time: new Date().toLocaleTimeString(),
    } as LogEntry;
    Object.assign(obj, entry);
    this.settings.logs.unshift(obj);
    this.settings.logs = this.settings.logs.slice(0, 100);
  }

  getCloudUrlPrefix(): string {
    const s3 = this.settings.s3;
    let base = String(s3.customDomainName || "").trim().replace(/\/+$/, "");
    if (!base) {
      const cleanEndpoint = String(s3.endpoint || "").trim().replace(/\/+$/, "");
      if (!cleanEndpoint || !String(s3.bucketName || "").trim()) return "";
      base = `${cleanEndpoint}/${s3.bucketName}`;
    }
    return normalizeCloudUrlPrefix(base);
  }

  getCloudUrlPrefixes(storageIdentity = this.getStorageIdentity()): string[] {
    return cloudUrlPrefixesForStorage(
      this.getCloudUrlPrefix(),
      this.settings.recognizedCloudDomains || [],
      storageIdentity
    );
  }

  getHistoricalCloudUrlPrefixes(storageIdentity = this.getStorageIdentity()): string[] {
    return this.settings.recognizedCloudDomains
      .filter((record) => record.storageIdentity === storageIdentity)
      .map((record) => record.prefix);
  }

  replaceHistoricalCloudUrlPrefixes(values: readonly string[]): void {
    const storageIdentity = this.getStorageIdentity();
    const otherStorageRecords = this.settings.recognizedCloudDomains
      .filter((record) => record.storageIdentity !== storageIdentity);
    const currentStorageRecords = normalizeRecognizedCloudDomains(values, storageIdentity);
    this.settings.recognizedCloudDomains = [
      ...otherStorageRecords,
      ...currentStorageRecords,
    ].slice(-100);
  }

  rememberCloudUrlPrefix(value: string, storageIdentity = this.getStorageIdentity()): boolean {
    const normalized = normalizeCloudUrlPrefix(value);
    if (!normalized || this.settings.recognizedCloudDomains.some((record) =>
      record.prefix === normalized && record.storageIdentity === storageIdentity
    )) return false;
    this.settings.recognizedCloudDomains = [
      ...this.settings.recognizedCloudDomains,
      { prefix: normalized, storageIdentity },
    ].slice(-100);
    return true;
  }

  private cloudKeyFromOwnUrl(url: string): string | null {
    return cloudKeyFromRecognizedUrl(url, this.getCloudUrlPrefixes());
  }

  isOwnCloudUrl(url: string): boolean {
    return this.cloudKeyFromOwnUrl(url) !== null;
  }

  private isKnownCloudUrl(url: string): boolean {
    const prefixes = [
      this.getCloudUrlPrefix(),
      ...this.settings.recognizedCloudDomains.map((record) => record.prefix),
    ].filter(Boolean);
    return cloudKeyFromRecognizedUrl(url, prefixes) !== null;
  }

  extractRemoteUrls(text: string): string[] {
    const keys: string[] = [];
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");

    for (const ref of extractRemoteImageRefs(text)) {
      const key = this.cloudKeyFromOwnUrl(ref.url);
      if (key) keys.push(key);
    }

    if (mirrorRoot) {
      for (const ref of extractLocalRefs(text)) {
        let target = ref.target;
        try {
          target = decodeURIComponent(target);
        } catch {
          // Keep the literal target when percent encoding is malformed.
        }
        const key = cloudKeyFromLocalMirrorPath(target, mirrorRoot);
        if (key) keys.push(key);
      }
    }
    return [...new Set(keys)];
  }

  remoteUrlToS3Key(url: string): string {
    return this.cloudKeyFromOwnUrl(url) || "";
  }

  async cacheRemoteUrls(file: TFile): Promise<void> {
    try {
      const text = await this.app.vault.read(file);
      const urls = this.extractRemoteUrls(text);

      if (urls.length > 0) {
        this.noteRemoteUrls.set(file.path, urls);
      } else {
        this.noteRemoteUrls.delete(file.path);
      }
      this.settings.noteSyncIndex[file.path] = {
        mtime: file.stat.mtime,
        size: file.stat.size,
        keys: urls,
        storageIdentity: this.getStorageIdentity(),
      };
      this.cancelPendingDeleteForPath(file.path);
      this.scheduleSettingsSave();
    } catch {
      // File might not be readable
    }
  }

  private settingsSaveTimer: number | null = null;

  private scheduleSettingsSave(): void {
    if (this.settingsSaveTimer) window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      void this.saveSettings();
    }, 1500);
  }

  private async trashLocalMirrorForKey(key: string, mirrorRoot = this.settings.localMirrorRoot): Promise<boolean> {
    const localPath = this.getLocalMirrorPathForCloudKey(key, mirrorRoot);
    if (!localPath) return false;
    const localFile = this.app.vault.getAbstractFileByPath(localPath);
    if (!(localFile instanceof TFile)) return false;
    await this.app.fileManager.trashFile(localFile);
    if (this.settings.pruneEmptyMirrorFolders) {
      await this.pruneEmptyMirrorParents(localFile.parent?.path || "", mirrorRoot);
    }
    return true;
  }

  private async pruneEmptyMirrorParents(startPath: string, configuredMirrorRoot: string): Promise<void> {
    const mirrorRoot = trimSlashes(configuredMirrorRoot || "98 cloudflareR2");
    let currentPath = trimSlashes(startPath);
    while (currentPath && currentPath !== mirrorRoot && currentPath.startsWith(`${mirrorRoot}/`)) {
      const folder = this.app.vault.getAbstractFileByPath(currentPath);
      if (!(folder instanceof TFolder) || folder.children.length > 0) break;
      const parentPath = folder.parent?.path || "";
      await this.app.fileManager.trashFile(folder);
      currentPath = parentPath;
    }
  }

  async initRemoteUrlCache(): Promise<void> {
    await this.rebuildRuntimeIndex(false);
  }

  private async handleFolderRename(folder: TFolder): Promise<void> {
    await this.rebuildRuntimeIndex(false);
    if (this.settings.enabled && this.settings.syncS3OnNoteMove) {
      const prefix = `${folder.path}/`;
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (file.path.startsWith(prefix) && canPathSync(this.getNotePathMode(file.path))) {
          this.markStartupCatchupPending(file);
        }
      }
      await this.saveSettings();
      await this.drainStartupCatchupQueue();
    }
    await this.startupPathIntegrityCheck();
  }

  async handleFolderDelete(folderPath: string): Promise<void> {
    const notesToDelete: string[] = [];
    for (const notePath of Object.keys(this.settings.noteSyncIndex)) {
      if (notePath.startsWith(folderPath + "/")) {
        notesToDelete.push(notePath);
      }
    }
    for (const notePath of notesToDelete) {
      await this.handleNoteDelete(notePath);
    }
  }

  async handleNoteDelete(notePath: string): Promise<void> {
    const snapshot = this.settings.noteSyncIndex[notePath];
    const keys = this.noteRemoteUrls.get(notePath) || snapshot?.keys;
    this.noteRemoteUrls.delete(notePath);
    delete this.settings.noteSyncIndex[notePath];
    if (
      this.settings.enabled &&
      this.settings.deleteRemoteOnNoteDelete &&
      canMutate(this.getNotePathMode(notePath)) &&
      keys &&
      keys.length > 0
    ) {
      const storageIdentity = snapshot
        ? snapshot.storageIdentity || "legacy-unbound"
        : this.getStorageIdentity();
      this.schedulePendingDelete(notePath, keys, "note-delete", notePath, storageIdentity);
    }
    await this.saveSettings();
  }

  private pendingDeleteId(
    notePath: string,
    reason: PendingDeleteRecord["reason"],
    storageIdentity: string
  ): string {
    return `${reason}:${storageIdentity}:${notePath}`;
  }

  private schedulePendingDelete(
    notePath: string,
    keys: readonly string[],
    reason: PendingDeleteRecord["reason"],
    authorizationPath = notePath,
    storageIdentity = this.getStorageIdentity()
  ): void {
    const enabledForReason = reason === "path-migration"
      ? this.settings.deleteOldObjectAfterPathMigration
      : this.settings.deleteRemoteOnNoteDelete;
    if (!enabledForReason) return;
    const uniqueKeys = [...new Set(keys.map((key) => trimSlashes(key)).filter(Boolean))];
    if (uniqueKeys.length === 0) return;
    const id = this.pendingDeleteId(notePath, reason, storageIdentity);
    const existing = this.settings.pendingDeleteQueue.find((record) => record.id === id);
    const expectedVersions = Object.fromEntries(uniqueKeys.flatMap((key) => {
      const owned = this.settings.ownedObjectKeys.find((record) =>
        record.key === key &&
        record.storageIdentity === storageIdentity &&
        typeof record.contentSha256 === "string" &&
        typeof record.size === "number" &&
        typeof record.operationId === "string" &&
        typeof record.etag === "string"
      );
      return owned?.contentSha256 && typeof owned.size === "number" &&
        owned.operationId && owned.etag
        ? [[key, {
            contentSha256: owned.contentSha256,
            size: owned.size,
            operationId: owned.operationId,
            etag: owned.etag,
          }]]
        : [];
    }));
    const dueAt = Date.now() + Math.max(1, Number(this.settings.deleteGraceMinutes) || 10) * 60_000;
    if (existing) {
      existing.keys = [...new Set([...existing.keys, ...uniqueKeys])];
      existing.expectedVersions = { ...existing.expectedVersions, ...expectedVersions };
      existing.dueAt = Math.max(existing.dueAt, dueAt);
      existing.authorizationPath = authorizationPath;
      existing.storageIdentity = storageIdentity;
    } else {
      this.settings.pendingDeleteQueue.push({
        id,
        notePath,
        authorizationPath,
        storageIdentity,
        keys: uniqueKeys,
        dueAt,
        reason,
        attempts: 0,
        expectedVersions,
      });
    }
    this.scheduleSettingsSave();
  }

  private cancelPendingDeleteForPath(notePath: string): void {
    const next = this.settings.pendingDeleteQueue.filter((record) =>
      record.notePath !== notePath || record.reason === "path-migration" || !!record.inFlight
    );
    if (next.length !== this.settings.pendingDeleteQueue.length) {
      this.settings.pendingDeleteQueue = next;
      this.scheduleSettingsSave();
    }
  }

  private getOwnedObjectRecord(key: string, storageIdentity = this.getStorageIdentity()) {
    if (this.isExcludedFromPathSync(key)) return null;
    return this.settings.ownedObjectKeys.find((record) =>
      record.key === key && record.storageIdentity === storageIdentity
    ) || null;
  }

  private captureReferenceSnapshot(files = this.app.vault.getMarkdownFiles()): ReferenceSnapshotEntry[] {
    return files
      .map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private getReferenceRecognitionIdentity(): string {
    return JSON.stringify({
      mirrorRoot: trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2"),
      cloudUrlPrefixes: this.getCloudUrlPrefixes(),
    });
  }

  private async collectFreshReferenceMap(): Promise<FreshReferenceMap> {
    const references = new Map<string, Set<string>>();
    const generation = this.noteChangeGeneration;
    const recognitionIdentity = this.getReferenceRecognitionIdentity();
    const files = this.app.vault.getMarkdownFiles()
      .slice()
      .sort((left, right) => left.path.localeCompare(right.path));
    const snapshot = this.captureReferenceSnapshot(files);
    const expectedByPath = new Map(snapshot.map((entry) => [entry.path, entry]));
    let complete = true;
    for (const file of files) {
      try {
        const expected = expectedByPath.get(file.path);
        const liveBefore = this.app.vault.getAbstractFileByPath(file.path);
        if (
          !expected ||
          !(liveBefore instanceof TFile) ||
          liveBefore.stat.mtime !== expected.mtime ||
          liveBefore.stat.size !== expected.size
        ) {
          complete = false;
          continue;
        }
        const text = await this.app.vault.read(liveBefore);
        const liveAfter = this.app.vault.getAbstractFileByPath(file.path);
        if (
          !(liveAfter instanceof TFile) ||
          liveAfter.stat.mtime !== expected.mtime ||
          liveAfter.stat.size !== expected.size
        ) {
          complete = false;
          continue;
        }
        const keys = this.extractRemoteUrls(text);
        for (const key of keys) {
          const notePaths = references.get(key) || new Set<string>();
          notePaths.add(file.path);
          references.set(key, notePaths);
        }
      } catch {
        complete = false;
      }
    }
    const afterSnapshot = this.captureReferenceSnapshot();
    complete = complete &&
      generation === this.noteChangeGeneration &&
      recognitionIdentity === this.getReferenceRecognitionIdentity() &&
      areReferenceSnapshotsEqual(snapshot, afterSnapshot);
    return { references, complete, generation, recognitionIdentity, snapshot };
  }

  private isReferenceScanCurrent(scan: FreshReferenceMap, storageIdentity: string): boolean {
    return scan.complete &&
      scan.generation === this.noteChangeGeneration &&
      scan.recognitionIdentity === this.getReferenceRecognitionIdentity() &&
      this.getStorageIdentity() === storageIdentity &&
      areReferenceSnapshotsEqual(scan.snapshot, this.captureReferenceSnapshot());
  }

  private isDeleteReasonEnabled(record: PendingDeleteRecord): boolean {
    return record.reason === "path-migration"
      ? this.settings.deleteOldObjectAfterPathMigration
      : this.settings.deleteRemoteOnNoteDelete;
  }

  private isDeletePathAuthorized(record: PendingDeleteRecord): boolean {
    return isDeletePathModeAuthorized(
      record.reason,
      this.getNotePathMode(record.authorizationPath || record.notePath)
    );
  }

  private isDeleteAuthorized(record: PendingDeleteRecord, storageIdentity: string): boolean {
    return this.settings.enabled &&
      this.settings.pendingDeleteQueue.includes(record) &&
      this.isDeleteReasonEnabled(record) &&
      record.storageIdentity === storageIdentity &&
      this.getStorageIdentity() === storageIdentity &&
      this.isDeletePathAuthorized(record);
  }

  private forgetOwnedObjectKey(key: string, storageIdentity: string): void {
    this.settings.ownedObjectKeys = this.settings.ownedObjectKeys.filter((record) =>
      record.key !== key || record.storageIdentity !== storageIdentity
    );
  }

  private async ensureExactMirrorBackup(
    key: string,
    body: Uint8Array,
    expectedHash: string,
    mirrorRoot: string
  ): Promise<TFile> {
    const mirrorPath = this.getLocalMirrorPathForCloudKey(key, mirrorRoot);
    if (!mirrorPath) throw new Error(`Local mirror path is invalid: ${key}`);
    const parentDir = mirrorPath.substring(0, mirrorPath.lastIndexOf("/"));
    if (parentDir) await this.ensureFolderExists(parentDir);
    let mirrorFile = this.app.vault.getAbstractFileByPath(mirrorPath);
    let matches = false;
    if (mirrorFile instanceof TFile && mirrorFile.stat.size === body.byteLength) {
      matches = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(mirrorFile))) === expectedHash;
    }
    if (!matches) {
      const safeBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      if (mirrorFile instanceof TFile) {
        await this.app.vault.modifyBinary(mirrorFile, safeBuffer);
      } else {
        await this.app.vault.createBinary(mirrorPath, safeBuffer);
      }
      mirrorFile = this.app.vault.getAbstractFileByPath(mirrorPath);
    }
    if (!(mirrorFile instanceof TFile)) throw new Error(`Local mirror backup is missing: ${mirrorPath}`);
    const savedHash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(mirrorFile)));
    if (savedHash !== expectedHash) throw new Error(`Local mirror backup verification failed: ${mirrorPath}`);
    return mirrorFile;
  }

  private async restoreDeletedObjectFromMirror(
    s3Config: S3Config,
    storageIdentity: string,
    mirrorRoot: string,
    key: string,
    expectedHash: string,
    expectedSize: number
  ): Promise<void> {
    const mirrorPath = this.getLocalMirrorPathForCloudKey(key, mirrorRoot);
    const mirrorFile = mirrorPath ? this.app.vault.getAbstractFileByPath(mirrorPath) : null;
    if (!(mirrorFile instanceof TFile)) throw new Error(`Recovery mirror is missing: ${key}`);
    const body = new Uint8Array(await this.app.vault.readBinary(mirrorFile));
    const hash = await sha256Hex(body);
    if (hash !== expectedHash || body.byteLength !== expectedSize) {
      throw new Error(`Recovery mirror version does not match: ${key}`);
    }
    const putResult = await putS3Object(
      s3Config,
      key,
      body,
      contentTypeForExt(mirrorFile.extension.toLowerCase()),
      (status, text) => this.t("uploadFailed", { status, text }),
      hash,
      { ifNoneMatch: true }
    );
    const restored = await this.readVerifiedCloudObject(s3Config, key);
    if (!restored || restored.hash !== hash) {
      throw new Error(`Recovered cloud object is missing: ${key}`);
    }
    if (isPutOwnershipConfirmed(putResult, restored.hash, restored.operationId)) {
      this.rememberOwnedObjectKey(
        key,
        storageIdentity,
        hash,
        body.byteLength,
        restored.operationId,
        restored.etag
      );
    } else {
      // A concurrent writer may have created identical bytes after our signed
      // GET. Preserve the object, but do not claim that external version.
      this.forgetOwnedObjectKey(key, storageIdentity);
    }
  }

  private finishPendingDeleteKey(record: PendingDeleteRecord, key: string): void {
    record.keys = record.keys.filter((candidate) => candidate !== key);
    if (record.expectedVersions) delete record.expectedVersions[key];
    if (record.inFlight?.key === key) record.inFlight = undefined;
  }

  /**
   * Reconcile one persisted write-ahead marker while its object lock is held.
   * This method deliberately does not gate its initial signed GET on the plugin
   * switch, grace period, reason switch, or current path policy: those settings
   * may prohibit a new DELETE, but they cannot erase an unfinished transaction.
   */
  private async reconcileInFlightDeleteLocked(
    record: PendingDeleteRecord,
    s3Snapshot: S3Config,
    storageIdentitySnapshot: string,
    mirrorRootSnapshot: string
  ): Promise<PendingDeleteOutcome> {
    const inFlight = record.inFlight;
    if (!inFlight || record.storageIdentity !== storageIdentitySnapshot) return "deferred";
    const key = inFlight.key;

    let remote: Awaited<ReturnType<S3ImageSyncPlugin["readVerifiedCloudObject"]>>;
    try {
      remote = await this.readVerifiedCloudObject(s3Snapshot, key);
    } catch {
      // The remote outcome is still ambiguous. Never clear the write-ahead
      // marker until a signed read establishes the current object state.
      return "deferred";
    }

    if (remote) {
      if (!isExactObjectVersion(
        inFlight,
        remote.hash,
        remote.body.byteLength,
        remote.operationId,
        remote.etag
      )) {
        this.forgetOwnedObjectKey(key, storageIdentitySnapshot);
        this.finishPendingDeleteKey(record, key);
        this.addLog({
          status: "remote-delete-skipped-version-changed",
          notePath: record.notePath,
          sourcePath: "",
          remoteUrl: key,
          trashed: false,
        });
        await this.saveSettings();
        return "preserved";
      }

      if (!this.isDeleteAuthorized(record, storageIdentitySnapshot)) {
        // The exact object is still present and current policy no longer allows
        // a new delete. End the transaction by preserving it.
        this.finishPendingDeleteKey(record, key);
        await this.saveSettings();
        return "preserved";
      }

      if (!supportsAtomicConditionalDelete(s3Snapshot)) {
        this.finishPendingDeleteKey(record, key);
        this.addLog({
          status: "remote-delete-skipped-provider-no-conditional-delete",
          notePath: record.notePath,
          sourcePath: s3Snapshot.provider,
          remoteUrl: key,
          trashed: false,
        });
        await this.saveSettings();
        return "preserved";
      }

      // The ambiguous DELETE did not remove this exact version. Persistently
      // clear the marker and retry only in a later queue pass.
      record.inFlight = undefined;
      if (!record.keys.includes(key)) record.keys.unshift(key);
      record.dueAt = Date.now() + 5 * 60_000;
      await this.saveSettings();
      return "deferred";
    }

    // The object is missing, so the prior DELETE may have succeeded. A new,
    // stable full-vault scan is mandatory; the pre-delete scan is never reused.
    const recoveryScan = await this.collectFreshReferenceMap();
    const referencedBy = recoveryScan.references.get(key);
    const mustRestore =
      !this.isReferenceScanCurrent(recoveryScan, storageIdentitySnapshot) ||
      !this.isDeleteAuthorized(record, storageIdentitySnapshot) ||
      (referencedBy?.size || 0) > 0;

    if (mustRestore) {
      try {
        await this.restoreDeletedObjectFromMirror(
          s3Snapshot,
          storageIdentitySnapshot,
          mirrorRootSnapshot,
          key,
          inFlight.contentSha256,
          inFlight.size
        );
      } catch {
        // Recovery did not complete. Keep inFlight so startup reconciliation
        // retries instead of silently accepting an unsafe deletion.
        return "deferred";
      }
      this.finishPendingDeleteKey(record, key);
      this.addLog({
        status: "remote-delete-restored-after-reference-change",
        notePath: record.notePath,
        sourcePath: referencedBy?.size ? [...referencedBy].join(", ") : "",
        remoteUrl: key,
        trashed: false,
      });
      await this.saveSettings();
      return "preserved";
    }

    // Final destructive check immediately before removing the recovery mirror
    // and completing the transaction.
    if (
      !this.isReferenceScanCurrent(recoveryScan, storageIdentitySnapshot) ||
      !this.isDeleteAuthorized(record, storageIdentitySnapshot) ||
      (recoveryScan.references.get(key)?.size || 0) > 0
    ) {
      try {
        await this.restoreDeletedObjectFromMirror(
          s3Snapshot,
          storageIdentitySnapshot,
          mirrorRootSnapshot,
          key,
          inFlight.contentSha256,
          inFlight.size
        );
      } catch {
        return "deferred";
      }
      this.finishPendingDeleteKey(record, key);
      await this.saveSettings();
      return "preserved";
    }

    const trashed = await this.trashLocalMirrorForKey(key, mirrorRootSnapshot).catch(() => false);
    this.forgetOwnedObjectKey(key, storageIdentitySnapshot);
    this.finishPendingDeleteKey(record, key);
    this.addLog({
      status: "remote-delete-reconciled-after-restart",
      notePath: record.notePath,
      sourcePath: record.reason,
      remoteUrl: key,
      trashed,
    });
    await this.saveSettings();
    return "deleted";
  }

  async processPendingDeletes(showNotice = false): Promise<void> {
    if (this.deleteProcessing) return;
    this.deleteProcessing = true;
    try {
      await this.processPendingDeletesUnlocked(showNotice);
    } finally {
      this.deleteProcessing = false;
    }
  }

  private async processPendingDeletesUnlocked(showNotice: boolean): Promise<void> {
    let deleted = 0;
    let preserved = 0;
    let failed = 0;
    const inFlightRecords = this.settings.pendingDeleteQueue.filter((record) => !!record.inFlight);
    const hasDueNewDeletes = this.settings.enabled && this.settings.pendingDeleteQueue.some((record) =>
      !record.inFlight && this.isDeleteReasonEnabled(record) && record.dueAt <= Date.now()
    );
    if (inFlightRecords.length === 0 && !hasDueNewDeletes) {
      if (showNotice) new Notice(this.t("noPendingDeletes"));
      return;
    }

    try {
      this.ensureS3Settings();
    } catch (error) {
      if (showNotice) new Notice(error instanceof Error ? error.message : String(error));
      return;
    }

    const s3Snapshot: S3Config = { ...this.settings.s3 };
    const mirrorRootSnapshot = this.settings.localMirrorRoot;
    const storageIdentitySnapshot = this.getStorageIdentity(s3Snapshot, mirrorRootSnapshot);

    // Phase 1: always reconcile persisted transactions first, even if normal
    // deletion is now disabled, not due, or outside the current path policy.
    for (const record of inFlightRecords) {
      const key = record.inFlight?.key;
      if (!key || record.storageIdentity !== storageIdentitySnapshot || this.keyOperations.has(key)) {
        failed++;
        continue;
      }
      this.reserveKeyOperation(key);
      try {
        const outcome = await this.reconcileInFlightDeleteLocked(
          record,
          s3Snapshot,
          storageIdentitySnapshot,
          mirrorRootSnapshot
        );
        if (outcome === "deleted") deleted++;
        else if (outcome === "preserved") preserved++;
        else failed++;
      } finally {
        this.releaseKeyOperation(key);
      }
    }
    this.settings.pendingDeleteQueue = this.settings.pendingDeleteQueue.filter((record) =>
      record.keys.length > 0 || !!record.inFlight
    );
    await this.saveSettings();

    if (this.settings.pendingDeleteQueue.some((record) => !!record.inFlight)) {
      // Do not start unrelated destructive work while any older transaction is
      // still ambiguous. The next timer pass retries reconciliation first.
      if (showNotice) new Notice(this.t("pendingDeletesDone", { deleted, preserved, failed }), 10000);
      return;
    }

    // Policy switches stop new DELETE requests, but never skipped phase 1.
    if (!this.settings.enabled) {
      if (showNotice) new Notice(this.t("pendingDeletesDone", { deleted, preserved, failed }), 10000);
      return;
    }

    const dueRecords = this.settings.pendingDeleteQueue.filter((record) =>
      !record.inFlight && this.isDeleteReasonEnabled(record) && record.dueAt <= Date.now()
    );
    if (dueRecords.length === 0) {
      if (showNotice) {
        if (inFlightRecords.length > 0) {
          new Notice(this.t("pendingDeletesDone", { deleted, preserved, failed }), 10000);
        } else {
          new Notice(this.t("noPendingDeletes"));
        }
      }
      return;
    }

    // Phase 2: a stable, complete full-vault snapshot authorizes new deletes.
    const freshScan = await this.collectFreshReferenceMap();
    if (!this.isReferenceScanCurrent(freshScan, storageIdentitySnapshot)) {
      for (const record of dueRecords) record.dueAt = Date.now() + 5 * 60_000;
      await this.saveSettings();
      if (showNotice) new Notice(this.t("pendingDeletesAuditIncomplete"));
      return;
    }

    const completedIds = new Set<string>();
    let unresolvedTransaction = false;
    for (const record of dueRecords) {
      if (!record.storageIdentity || record.storageIdentity !== storageIdentitySnapshot) {
        record.dueAt = Date.now() + 60 * 60_000;
        continue;
      }
      if (!this.isDeletePathAuthorized(record)) {
        preserved += record.keys.length;
        completedIds.add(record.id);
        continue;
      }

      const retryKeys: string[] = [];
      for (const key of [...record.keys]) {
        let deleteLockHeld = false;
        try {
          if (
            !this.isDeleteAuthorized(record, storageIdentitySnapshot) ||
            !this.isReferenceScanCurrent(freshScan, storageIdentitySnapshot) ||
            this.keyOperations.has(key) ||
            (record.inFlight !== undefined && record.inFlight.key !== key)
          ) {
            retryKeys.push(key);
            continue;
          }
          this.reserveKeyOperation(key);
          deleteLockHeld = true;

          const referencedBy = freshScan.references.get(key);
          if (referencedBy?.size) {
            preserved++;
            this.finishPendingDeleteKey(record, key);
            this.addLog({
              status: "remote-delete-skipped-shared-reference",
              notePath: record.notePath,
              sourcePath: [...referencedBy].join(", "),
              remoteUrl: key,
              trashed: false,
            });
            continue;
          }

          if (!supportsAtomicConditionalDelete(s3Snapshot)) {
            preserved++;
            this.finishPendingDeleteKey(record, key);
            this.addLog({
              status: "remote-delete-skipped-provider-no-conditional-delete",
              notePath: record.notePath,
              sourcePath: s3Snapshot.provider,
              remoteUrl: key,
              trashed: false,
            });
            continue;
          }

          const expected = record.expectedVersions?.[key];
          const owned = this.getOwnedObjectRecord(key, storageIdentitySnapshot);
          if (!expected || !isOwnedVersionEligible(key, storageIdentitySnapshot, expected, owned)) {
            preserved++;
            this.finishPendingDeleteKey(record, key);
            this.addLog({
              status: "remote-delete-skipped-unversioned-or-unowned",
              notePath: record.notePath,
              sourcePath: "",
              remoteUrl: key,
              trashed: false,
            });
            continue;
          }

          const remote = await this.readVerifiedCloudObject(s3Snapshot, key);
          if (!remote) {
            if (
              !this.isDeleteAuthorized(record, storageIdentitySnapshot) ||
              !this.isReferenceScanCurrent(freshScan, storageIdentitySnapshot)
            ) {
              retryKeys.push(key);
              continue;
            }
            const trashed = await this.trashLocalMirrorForKey(key, mirrorRootSnapshot).catch(() => false);
            this.forgetOwnedObjectKey(key, storageIdentitySnapshot);
            this.finishPendingDeleteKey(record, key);
            this.addLog({
              status: "remote-delete-already-missing",
              notePath: record.notePath,
              sourcePath: record.reason,
              remoteUrl: key,
              trashed,
            });
            deleted++;
            continue;
          }
          if (!isExactObjectVersion(
            expected,
            remote.hash,
            remote.body.byteLength,
            remote.operationId,
            remote.etag
          )) {
            preserved++;
            this.forgetOwnedObjectKey(key, storageIdentitySnapshot);
            this.finishPendingDeleteKey(record, key);
            this.addLog({
              status: "remote-delete-skipped-version-changed",
              notePath: record.notePath,
              sourcePath: "",
              remoteUrl: key,
              trashed: false,
            });
            continue;
          }

          await this.ensureExactMirrorBackup(
            key,
            remote.body,
            expected.contentSha256,
            mirrorRootSnapshot
          );
          if (
            !this.isDeleteAuthorized(record, storageIdentitySnapshot) ||
            !this.isReferenceScanCurrent(freshScan, storageIdentitySnapshot)
          ) {
            retryKeys.push(key);
            continue;
          }

          record.inFlight = {
            key,
            contentSha256: expected.contentSha256,
            size: expected.size,
            operationId: expected.operationId,
            etag: expected.etag,
            startedAt: Date.now(),
          };
          // Write-ahead record: serial persistence must complete before DELETE.
          await this.saveSettings();

          if (
            !this.isDeleteAuthorized(record, storageIdentitySnapshot) ||
            !this.isReferenceScanCurrent(freshScan, storageIdentitySnapshot)
          ) {
            record.inFlight = undefined;
            retryKeys.push(key);
            await this.saveSettings();
            continue;
          }

          try {
            const deleteResult = await deleteS3Object(s3Snapshot, key, expected.etag);
            if (deleteResult === "unsupported" || deleteResult === "precondition-failed") {
              if (deleteResult === "precondition-failed") {
                this.forgetOwnedObjectKey(key, storageIdentitySnapshot);
              }
              this.finishPendingDeleteKey(record, key);
              this.addLog({
                status: deleteResult === "unsupported"
                  ? "remote-delete-skipped-provider-no-conditional-delete"
                  : "remote-delete-skipped-version-changed",
                notePath: record.notePath,
                sourcePath: deleteResult === "unsupported" ? s3Snapshot.provider : "",
                remoteUrl: key,
                trashed: false,
              });
              await this.saveSettings();
              preserved++;
              continue;
            }
          } catch {
            // The DELETE outcome is ambiguous. Reconcile immediately while the
            // same key lock is held; only a still-unavailable signed GET defers.
          }
          const outcome = await this.reconcileInFlightDeleteLocked(
            record,
            s3Snapshot,
            storageIdentitySnapshot,
            mirrorRootSnapshot
          );
          if (outcome === "deleted") deleted++;
          else if (outcome === "preserved") preserved++;
          else {
            retryKeys.push(key);
            failed++;
          }
        } catch {
          retryKeys.push(key);
          failed++;
        } finally {
          if (deleteLockHeld) this.releaseKeyOperation(key);
        }
      }

      if (retryKeys.length > 0 || record.inFlight) {
        if (record.inFlight && !retryKeys.includes(record.inFlight.key)) {
          retryKeys.push(record.inFlight.key);
        }
        record.keys = [...new Set(retryKeys)];
        record.attempts += 1;
        record.dueAt = Date.now() + Math.min(60, 5 * Math.max(1, record.attempts)) * 60_000;
        unresolvedTransaction = !!record.inFlight;
      } else {
        completedIds.add(record.id);
      }
      if (unresolvedTransaction) break;
    }

    this.settings.pendingDeleteQueue = this.settings.pendingDeleteQueue.filter((record) =>
      !completedIds.has(record.id) && (record.keys.length > 0 || !!record.inFlight)
    );
    await this.saveSettings();
    if (showNotice) new Notice(this.t("pendingDeletesDone", { deleted, preserved, failed }), 10000);
  }

  private markStartupCatchupPending(file: TFile): void {
    if (!canMutate(this.getNotePathMode(file.path))) return;
    this.startupCatchupQueue.set(file.path, file);
    if (!this.settings.startupCatchupPendingPaths.includes(file.path)) {
      this.settings.startupCatchupPendingPaths.push(file.path);
    }
  }

  private async drainStartupCatchupQueue(): Promise<void> {
    if (this.startupCatchupRun) return this.startupCatchupRun;
    if (this.startupCatchupQueue.size === 0) return;

    const run = (async (): Promise<void> => {
      let processed = 0;
      let failed = 0;
      const initialTotal = this.startupCatchupQueue.size;
      const notice = new Notice(this.t("startupCatchupWorking", { done: 0, total: initialTotal }), 0);

      while (this.startupCatchupQueue.size > 0) {
        const entry = this.startupCatchupQueue.entries().next().value as [string, TFile] | undefined;
        if (!entry) break;
        const [path] = entry;
        this.startupCatchupQueue.delete(path);
        const current = this.app.vault.getAbstractFileByPath(path);

        if (!(current instanceof TFile) || current.extension !== "md" || !canMutate(this.getNotePathMode(path))) {
          this.settings.startupCatchupPendingPaths = this.settings.startupCatchupPendingPaths
            .filter((candidate) => candidate !== path);
          await this.saveSettings();
          continue;
        }

        const succeeded = await this.autoTransferRemoteForFile(current, true);
        if (succeeded) {
          processed++;
          this.settings.startupCatchupPendingPaths = this.settings.startupCatchupPendingPaths
            .filter((candidate) => candidate !== path);
          await this.saveSettings();
        } else {
          failed++;
        }
        const total = processed + failed + this.startupCatchupQueue.size;
        notice.setMessage(this.t("startupCatchupWorking", { done: processed + failed, total }));
      }

      notice.hide();
      new Notice(this.t("startupCatchupDone", { processed, failed }), 10000);
    })();

    this.startupCatchupRun = run;
    try {
      await run;
    } finally {
      if (this.startupCatchupRun === run) this.startupCatchupRun = null;
    }
  }

  private async rebuildRuntimeIndex(runCatchup: boolean): Promise<void> {
    const previous = this.settings.noteSyncIndex || {};
    const hadBaseline = Object.keys(previous).length > 0;
    const next: Record<string, NoteSyncSnapshot> = {};
    const pendingCatchup = new Set(this.settings.startupCatchupPendingPaths || []);
    this.noteRemoteUrls.clear();

    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const keys = this.extractRemoteUrls(await this.app.vault.read(file));
        next[file.path] = {
          mtime: file.stat.mtime,
          size: file.stat.size,
          keys,
          storageIdentity: this.getStorageIdentity(),
        };
        if (keys.length > 0) this.noteRemoteUrls.set(file.path, keys);
        const old = previous[file.path];
        const needsFirstPolicyCatchup = !hadBaseline && this.settings.processingScopeMode === "policy";
        const changedSinceBaseline = hadBaseline &&
          (!old || old.mtime !== file.stat.mtime || old.size !== file.stat.size);
        if (
          runCatchup && canMutate(this.getNotePathMode(file.path)) &&
          (needsFirstPolicyCatchup || changedSinceBaseline)
        ) {
          pendingCatchup.add(file.path);
        }
      } catch {
        // Skip unreadable notes without erasing their previous snapshot.
        if (previous[file.path]) next[file.path] = previous[file.path];
      }
    }

    if (runCatchup && hadBaseline && this.settings.deleteRemoteOnNoteDelete) {
      for (const [notePath, snapshot] of Object.entries(previous)) {
        if (!next[notePath] && canMutate(this.getNotePathMode(notePath))) {
          this.schedulePendingDelete(
            notePath,
            snapshot.keys,
            "startup-missing",
            notePath,
            snapshot.storageIdentity || "legacy-unbound"
          );
        }
      }
    }

    this.settings.startupCatchupPendingPaths = [...pendingCatchup].filter((path) =>
      !!next[path] && canMutate(this.getNotePathMode(path))
    );
    if (runCatchup) {
      for (const path of this.settings.startupCatchupPendingPaths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && file.extension === "md") {
          this.startupCatchupQueue.set(path, file);
        }
      }
    }
    this.settings.noteSyncIndex = next;
    await this.saveSettings();
  }

  private async initializeRuntimeState(): Promise<void> {
    if (this.runtimeInitialized || this.runtimeInitializing) return;
    this.runtimeInitializing = true;
    try {
      let attempts = 0;
      let changedDuringScan: boolean;
      do {
        const generationBefore = this.noteChangeGeneration;
        await this.rebuildRuntimeIndex(this.settings.enabled && this.settings.startupCatchupEnabled);
        changedDuringScan = generationBefore !== this.noteChangeGeneration;
        attempts++;
      } while (changedDuringScan && attempts < 3);

      if (changedDuringScan) throw new Error("Vault kept changing during startup indexing");
      this.runtimeInitialized = true;
      if (this.settings.enabled) {
        await this.drainStartupCatchupQueue();
        await this.startupPathIntegrityCheck();
      }
      await this.processPendingDeletes(false);
      if (!this.isMobile && !this.deleteQueueTimer) {
        this.deleteQueueTimer = window.setInterval(() => void this.processPendingDeletes(false), 60_000);
      }
    } catch {
      this.runtimeInitialized = false;
      this.startupTimer = window.setTimeout(() => {
        this.startupTimer = null;
        void this.initializeRuntimeState();
      }, 5000);
    } finally {
      this.runtimeInitializing = false;
    }
  }

  private async onEditorPaste(evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): Promise<void> {
    if (!this.settings.enabled || !this.settings.autoUploadOnPaste) return;
    const noteFile = info.file || this.app.workspace.getActiveFile();
    if (!(noteFile instanceof TFile) || !canMutate(this.getNotePathMode(noteFile.path))) return;

    const files = Array.from(evt.clipboardData?.files || []);
    const images = files.filter(f => f.type.startsWith("image/"));
    if (images.length === 0) return;

    evt.preventDefault();
    try {
      this.ensureS3Settings();
    } catch (e) {
      new Notice(this.t("missingS3", { settings: (e as Error).message }));
      return;
    }
    await this.handlePastedImages(images, editor, noteFile);
  }

  private async onEditorDrop(evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): Promise<void> {
    if (!this.settings.enabled || !this.settings.autoUploadOnPaste) return;
    const noteFile = info.file || this.app.workspace.getActiveFile();
    if (!(noteFile instanceof TFile) || !canMutate(this.getNotePathMode(noteFile.path))) return;

    const files = Array.from(evt.dataTransfer?.files || []);
    const images = files.filter(f => f.type.startsWith("image/"));
    if (images.length === 0) return;

    evt.preventDefault();
    try {
      this.ensureS3Settings();
    } catch (e) {
      new Notice(this.t("missingS3", { settings: (e as Error).message }));
      return;
    }
    await this.handlePastedImages(images, editor, noteFile);
  }

  private async handlePastedImages(images: File[], editor: Editor, noteFile: TFile): Promise<void> {
    for (const file of images) {
      const placeholderId = Math.random().toString(36).substring(2, 8);
      const originalName = file.name || "image.png";
      const placeholder = `![Uploading ${originalName} ${placeholderId}...]()`;
      editor.replaceSelection(placeholder + "\n");
      let operationLockKey: string | undefined;
      let linkInserted = false;
      try {
        const buffer = await file.arrayBuffer();
        const result = await this.uploadBuffer(buffer, originalName, noteFile);
        operationLockKey = result.operationLockKey;
        if (result.targetNotePath && noteFile.path !== result.targetNotePath) {
          throw new Error(this.t("originalLinkChanged", { link: result.targetNotePath }));
        }
        const targetUrl = (this.settings.linkMode === "local" && result.localPath)
          ? result.localPath.split("/").map(encodeURIComponent).join("/")
          : result.publicUrl;
        const replacement = `![${escapeMarkdownLabel(originalName)}](${targetUrl})`;

        for (let i = 0; i < editor.lineCount(); i++) {
          const line = editor.getLine(i);
          if (line.includes(placeholder)) {
            editor.setLine(i, replaceAllLiteral(line, placeholder, replacement));
            linkInserted = true;
            break;
          }
        }
        if (linkInserted && !(await this.waitForPersistedNoteReference(noteFile, result.key))) {
          this.postponePendingDeletesForKey(result.key);
          new Notice(this.t("pasteSavePending"), 10000);
        }
      } catch (error: unknown) {
        new Notice(`Failed to upload ${originalName}: ${error instanceof Error ? error.message : String(error)}`);
        for (let i = 0; i < editor.lineCount(); i++) {
          const line = editor.getLine(i);
          if (line.includes(placeholder)) {
            editor.setLine(i, replaceAllLiteral(line, placeholder, `![Failed to upload ${originalName}]()`));
            break;
          }
        }
      } finally {
        this.releaseKeyOperation(operationLockKey);
      }
    }
  }

  // ─── Remote Image Transfer ───────────────────────────────────────────

  async findRemoteCandidatesInNote(noteFile: TFile): Promise<RemoteCandidate[]> {
    if (this.isIgnoredNote(noteFile)) return [];
    const text = await this.app.vault.read(noteFile);
    const refs = extractRemoteImageRefs(text);
    // Links belonging to any remembered storage are never adopted as arbitrary
    // external images. Only the active storage identity can be parsed/mutated.
    const filtered = refs.filter((ref) => !this.isKnownCloudUrl(ref.url));
    // Deduplicate by URL
    const byUrl = new Map<string, RemoteCandidate>();
    for (const ref of filtered) {
      const existing = byUrl.get(ref.url);
      if (existing) {
        existing.refs.push(ref);
      } else {
        byUrl.set(ref.url, {
          url: ref.url,
          alt: ref.alt,
          guessedExt: guessExtFromUrl(ref.url),
          refs: [ref],
        });
      }
    }
    return Array.from(byUrl.values());
  }

  private static readonly DOWNLOAD_MAX_RETRIES = 3;
  private static readonly DOWNLOAD_BASE_DELAY_MS = 2000;

  async downloadRemoteImage(url: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
    const maxBytes = Math.max(0, this.settings.remoteImageMaxSizeMiB || 10) * 1024 * 1024;

    for (let attempt = 0; attempt <= S3ImageSyncPlugin.DOWNLOAD_MAX_RETRIES; attempt++) {
      try {
        const response = await requestUrl({
          url,
          method: "GET",
          throw: false,
        });

        if (response.status >= 400) {
          // Retriable server errors
          if ((response.status === 429 || response.status >= 500) && attempt < S3ImageSyncPlugin.DOWNLOAD_MAX_RETRIES) {
            new Notice(this.t("downloadRetrying", { attempt: attempt + 1, max: S3ImageSyncPlugin.DOWNLOAD_MAX_RETRIES }));
            await new Promise((r) => window.setTimeout(r, S3ImageSyncPlugin.DOWNLOAD_BASE_DELAY_MS * Math.pow(2, attempt)));
            continue;
          }
          throw new Error(`HTTP ${response.status}`);
        }

        const contentType = (response.headers["content-type"] || response.headers["Content-Type"] || "").toLowerCase();
        // Validate it's an image
        if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
          throw new Error(`Not an image (Content-Type: ${contentType})`);
        }

        const buffer = response.arrayBuffer;
        if (buffer.byteLength > maxBytes) {
          throw new Error(this.t("remoteImageTooLarge", { max: this.settings.remoteImageMaxSizeMiB }));
        }

        return { buffer, contentType };
      } catch (error: unknown) {
        // Network errors are retriable
        if (attempt < S3ImageSyncPlugin.DOWNLOAD_MAX_RETRIES) {
          const isFormattedError = error instanceof Error && (error.message.startsWith("HTTP ") || error.message.startsWith("Not an image") || error.message.includes("MiB"));
          if (isFormattedError) throw error; // Don't retry non-retriable errors
          new Notice(this.t("downloadRetrying", { attempt: attempt + 1, max: S3ImageSyncPlugin.DOWNLOAD_MAX_RETRIES }));
          await new Promise((r) => window.setTimeout(r, S3ImageSyncPlugin.DOWNLOAD_BASE_DELAY_MS * Math.pow(2, attempt)));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Download failed after all retries");
  }

  async transferRemoteImagesInNote(
    noteFile: TFile,
    candidates: RemoteCandidate[],
    progress: ((state: ProgressState) => void) | null = null
  ): Promise<ReplaceResult> {
    if (!this.settings.enabled || !canMutate(this.getNotePathMode(noteFile.path))) {
      throw new Error(this.t("pathNoLongerManaged"));
    }
    this.ensureS3Settings();
    const replacementMap = new Map<string, string>();
    let replaced = 0;
    const total = candidates.length;
    let completed = 0;
    const heldLocks: string[] = [];

    try {
      for (const candidate of candidates) {
      progress?.({
        phase: "downloading",
        current: completed,
        total,
        label: new URL(candidate.url).hostname,
      });

      try {
        const { buffer } = await this.downloadRemoteImage(candidate.url);
        // Derive a filename from the URL for the upload path template
        const urlPath = new URL(candidate.url).pathname;
        const urlBasename = urlPath.split("/").pop() || "remote-image";
        const originalName = decodeURIComponent(urlBasename);

        progress?.({
          phase: "uploading",
          current: completed,
          total,
          label: originalName,
        });

        const result = await this.uploadBuffer(buffer, originalName, noteFile);
        if (result.operationLockKey) heldLocks.push(result.operationLockKey);
        if (result.targetNotePath && result.targetNotePath !== noteFile.path) {
          throw new Error(this.t("originalLinkChanged", { link: result.targetNotePath }));
        }
        // Build replacement for all refs of this candidate
        const targetUrl = (this.settings.linkMode === "local" && result.localPath) 
          ? result.localPath.split("/").map(encodeURIComponent).join("/") 
          : result.publicUrl;
        for (const ref of candidate.refs) {
          const newMarkdown = `![${escapeMarkdownLabel(ref.alt || originalName)}](${targetUrl})`;
          replacementMap.set(ref.raw, newMarkdown);
        }
        completed++;
      } catch (error: unknown) {
        new Notice(this.t("downloadFailed", { error: error instanceof Error ? error.message : String(error) }));
        completed++;
        // Continue with other candidates
      }
      }

      if (replacementMap.size === 0) return { replaced: 0 };

      if (!this.settings.enabled || !canMutate(this.getNotePathMode(noteFile.path))) {
        throw new Error(this.t("pathNoLongerManaged"));
      }

      progress?.({
        phase: "rewriting",
        current: completed,
        total,
        label: noteFile.name,
      });

      await this.app.vault.process(noteFile, (current) => {
        let next = current;
        for (const [raw, replacement] of replacementMap.entries()) {
          if (next.includes(raw)) {
            next = replaceAllLiteral(next, raw, replacement);
            replaced++;
          }
        }
        return next;
      });

      progress?.({
        phase: "done",
        current: total,
        total,
        label: this.t("phaseDone"),
      });

      return { replaced };
    } finally {
      for (const key of heldLocks) this.releaseKeyOperation(key);
    }
  }

  private remoteTransferDebounceTimers = new Map<string, number>();

  private scheduleBackgroundImageSync(file: TFile): void {
    if (!this.settings.enabled || this.isIgnoredNote(file)) return;
    if (!this.settings.autoTransferRemoteImages && this.settings.linkMode !== "cloud") return;

    const existing = this.remoteTransferDebounceTimers.get(file.path);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.remoteTransferDebounceTimers.delete(file.path);
      void this.autoTransferRemoteForFile(file);
    }, 5000);
    this.remoteTransferDebounceTimers.set(file.path, timer);
  }

  configureAutoRemoteTransfer(): void {
    // Listen for notes created by Obsidian, Web Clipper, scripts, or other plugins.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.noteChangeGeneration++;
        if (!this.runtimeInitialized) return;
        this.cancelPendingDeleteForPath(file.path);
        void this.cacheRemoteUrls(file);
        this.scheduleBackgroundImageSync(file);
      })
    );
    // Also listen for a note that receives links after its initial creation.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.noteChangeGeneration++;
        if (!this.runtimeInitialized) return;
        void this.cacheRemoteUrls(file);
        this.scheduleBackgroundImageSync(file);
      })
    );
  }

  private async autoTransferRemoteForFile(file: TFile, silent = false): Promise<boolean> {
    if (!this.settings.enabled || !canMutate(this.getNotePathMode(file.path))) return true;
    try {
      this.ensureS3Settings();
    } catch { return false; }
    try {
      if (this.settings.linkMode === "cloud") {
        const localImageCandidates = (await this.findCandidatesInNote(file, {
          requireAutoCandidate: false,
          enforceAttachmentRoot: false,
          enforceSizeRule: false,
          skipExtensionFilter: false,
          includeLocalMirror: true,
        })).filter((candidate) => candidate.replacement === "image");
        if (localImageCandidates.length > 0) {
          const result = await this.replaceCandidates(file, localImageCandidates, null, "cloud", false);
          if (!silent && result.replaced > 0) {
            new Notice(this.t("autoScanReplaced", { count: result.replaced }));
          }
        }
      }

      if (this.settings.autoTransferRemoteImages) {
        const candidates = await this.findRemoteCandidatesInNote(file);
        if (candidates.length > 0) {
          const result = await this.transferRemoteImagesInNote(file, candidates);
          if (!silent && result.replaced > 0) {
            new Notice(this.t("remoteTransferNotice", { count: result.replaced }));
          }
        }
      }

      if (this.settings.syncS3OnNoteMove && this.usesCanonicalNotePathTemplate()) {
        await this.syncS3PathsForNote(file, file.path, false);
      }
      await this.cacheRemoteUrls(file);
      const snapshot = this.settings.noteSyncIndex[file.path];
      return !!snapshot && snapshot.mtime === file.stat.mtime && snapshot.size === file.stat.size;
    } catch (error) {
      this.addLog({ status: "automatic-image-sync-failed", notePath: file.path, sourcePath: "", remoteUrl: "" });
      if (!silent) {
        new Notice(this.t("autoScanFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
      return false;
    }
  }

  // ─── Link Mode Toggle ──────────────────────────────────────────────

  async executeToggleLinks(targetMode: "local" | "cloud", scope: "current" | "vault"): Promise<void> {
    if (!this.settings.enabled) {
      new Notice(this.t("disabled"));
      return;
    }
    const candidateFiles = scope === "vault"
      ? this.app.vault.getMarkdownFiles()
      : [this.app.workspace.getActiveFile()].filter((f): f is TFile => f instanceof TFile && f.extension === "md");
    const files = candidateFiles.filter((file) => !this.isIgnoredNote(file));

    if (files.length === 0) {
      new Notice(this.t("openMarkdownFirst"));
      return;
    }

    let totalChanged = 0;
    let failed = 0;
    const notice = new Notice(this.t("toggleLinkWorking"), 0);
    for (const file of files) {
      try {
        const changed = await this.toggleLinksInNote(file, targetMode);
        totalChanged += changed;
      } catch {
        this.addLog({ status: "toggle-links-failed", notePath: file.path, sourcePath: "", remoteUrl: "" });
        failed++;
      }
    }
    notice.hide();

    if (scope === "vault") {
      this.settings.linkMode = targetMode;
      await this.saveSettings();
    }
    const mode = targetMode === "local" ? this.t("linkModeLocal") : this.t("linkModeCloud");
    new Notice(this.t(failed > 0 ? "toggleLinkDoneWithFailures" : "toggleLinkDone", {
      count: totalChanged,
      failed,
      mode,
    }));
  }

  private async toggleLinksInNote(noteFile: TFile, targetMode: "local" | "cloud"): Promise<number> {
    if (!this.settings.enabled || !canMutate(this.getNotePathMode(noteFile.path))) return 0;
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (!mirrorRoot) return 0;

    if (targetMode === "cloud") {
      const localCandidates = (await this.findCandidatesInNote(noteFile, {
        requireAutoCandidate: false,
        enforceAttachmentRoot: false,
        enforceSizeRule: false,
        skipExtensionFilter: true,
        includeLocalMirror: true,
      })).filter((candidate) => candidate.replacement === "image");
      if (localCandidates.length === 0) return 0;
      const result = await this.replaceCandidates(noteFile, localCandidates, null, "cloud", false);
      return result.replaced;
    }

    let changed = 0;
    await this.app.vault.process(noteFile, (content) => {
      let next = content;
      for (const ref of extractRemoteImageRefs(content)) {
        const cloudKey = this.remoteUrlToS3Key(ref.url);
        if (!cloudKey) continue;
        const localFile = this.findLocalMirrorForCloudKey(cloudKey, mirrorRoot);
        if (!localFile || !next.includes(ref.raw)) continue;
        const labelEnd = ref.raw.indexOf("](");
        if (labelEnd < 0) continue;
        const encodedLocal = localFile.split("/").map(encodeURIComponent).join("/");
        next = replaceAllLiteral(next, ref.raw, `${ref.raw.slice(0, labelEnd + 1)}(${encodedLocal})`);
        changed++;
      }

      return next;
    });

    return changed;
  }

  private findLocalMirrorForCloudKey(cloudKey: string, mirrorRoot: string): string | null {
    const exactPath = `${mirrorRoot}/${trimSlashes(cloudKey)}`;
    if (this.app.vault.getAbstractFileByPath(exactPath) instanceof TFile) {
      return exactPath;
    }

    // Cloud key might have .webp extension, but local file has original extension
    const stem = cloudKey.replace(/\.[^/.]+$/, "");
    const candidates = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tiff", "avif"];

    // Just in case the file was saved with a non-standard extension (like the previous .640 bug)
    const exactExt = cloudKey.split(".").pop();
    if (exactExt && !candidates.includes(exactExt.toLowerCase())) {
      candidates.push(exactExt);
    }

    for (const ext of candidates) {
      const tryPath = `${mirrorRoot}/${stem}.${ext}`;
      if (this.app.vault.getAbstractFileByPath(tryPath)) {
        return tryPath;
      }
    }
    return null;
  }

  // ─── Three-way consistency audit ──────────────────────────────────

  async runConsistencyAudit(deep: boolean): Promise<void> {
    if (!this.settings.enabled) {
      new Notice(this.t("disabled"));
      return;
    }
    try {
      this.ensureS3Settings();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }

    const notice = new Notice(this.t("auditWorking"), 0);
    try {
      const noteRefs: NoteObjectReference[] = [];
      const protectionRefs: ProtectionObjectReference[] = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        const keys = this.extractRemoteUrls(await this.app.vault.read(file));
        if (!this.isAuditedNotePath(file.path)) {
          protectionRefs.push(...keys.map((key) => ({ notePath: file.path, key })));
          continue;
        }
        for (const key of keys) {
          const expectedKey = !canCheckPath(this.getNotePathMode(file.path)) || this.isExcludedFromPathSync(key)
            ? undefined
            : this.getCanonicalKeyForNote(key, file) || undefined;
          noteRefs.push({ notePath: file.path, key, expectedKey });
        }
      }

      const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
      const referencedKeys = new Set(noteRefs.map((ref) => ref.key));
      const localObjects: LocalObjectRecord[] = [];
      for (const file of this.app.vault.getFiles()) {
        const key = cloudKeyFromLocalMirrorPath(file.path, mirrorRoot);
        if (!key) continue;
        let hash: string | undefined;
        if (deep && referencedKeys.has(key)) {
          hash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(file)));
        }
        localObjects.push({ key, size: file.stat.size, hash });
      }

      const cloudObjects: CloudObjectRecord[] = [];
      const seenTokens = new Set<string>();
      let continuationToken: string | undefined;
      do {
        const page = await listS3ObjectsV2(this.settings.s3, { continuationToken, maxKeys: 1000 });
        cloudObjects.push(...page.objects.map((object) => ({
          key: object.key,
          size: object.size,
          etag: object.etag || undefined,
        })));
        const nextToken = page.nextContinuationToken || undefined;
        if (!page.isTruncated) break;
        if (!nextToken || seenTokens.has(nextToken)) {
          throw new Error(this.t("auditIncompleteListing"));
        }
        seenTokens.add(nextToken);
        continuationToken = nextToken;
        notice.setMessage(this.t("auditListingProgress", { count: cloudObjects.length }));
      } while (continuationToken);

      if (deep) {
        let checked = 0;
        for (const object of cloudObjects) {
          if (!referencedKeys.has(object.key)) continue;
          const head = await headS3Object(this.settings.s3, object.key);
          if (head.exists) {
            object.size = head.size ?? object.size;
            object.etag = head.etag || object.etag;
            object.contentSha256 = head.contentSha256 || undefined;
          }
          checked++;
          if (checked % 20 === 0) {
            notice.setMessage(this.t("auditHashProgress", { count: checked }));
          }
        }
      }

      const report = auditConsistency({
        noteRefs,
        protectionRefs,
        localObjects,
        cloudObjects,
        protectedPrefixes: this.settings.excludedPathSyncKeyPrefixes,
      });
      notice.hide();
      new ConsistencyAuditModal(this.app, this, report, deep).open();
    } catch (error) {
      notice.hide();
      new Notice(this.t("auditFailed", { error: error instanceof Error ? error.message : String(error) }), 12000);
    }
  }

  // ─── Cloud to Local Migration ─────────────────────────────────────

  async downloadCloudToLocal(): Promise<void> {
    if (!this.settings.enabled) {
      new Notice(this.t("disabled"));
      return;
    }
    try {
      this.ensureS3Settings();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
      return;
    }

    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (!mirrorRoot) {
      new Notice(this.t("migrationNoDomain"));
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    const processedKeys = new Set<string>();
    const notice = new Notice(this.t("migrationWorking"), 0);

    for (const file of files) {
      if (this.isIgnoredNote(file)) continue;
      // Use extractRemoteUrls — already handles URL decoding and derives cloud keys
      const cloudKeys = this.extractRemoteUrls(await this.app.vault.read(file));
      for (const cloudKey of cloudKeys) {
        if (processedKeys.has(cloudKey)) continue;
        processedKeys.add(cloudKey);
        const localPath = this.getLocalMirrorPathForCloudKey(cloudKey);
        if (!localPath) {
          failed++;
          continue;
        }

        try {
          const result = await this.downloadCloudKeyToMirror(cloudKey);
          if (result === "missing") {
            failed++;
          } else if (result === "unchanged") {
            skipped++;
          } else {
            downloaded++;
            notice.setMessage(this.t("migrationProgress", { count: downloaded }));
          }
        } catch {
          failed++;
        }
      }
    }

    notice.hide();
    const msgParts = [`下载: ${downloaded}`, `跳过: ${skipped}`];
    if (failed > 0) msgParts.push(`失败: ${failed}`);
    new Notice(`迁移完成 — ${msgParts.join("  |  ")}`);
  }

  // ─── S3 Path Sync on Note Rename ────────────────────────────────────

  private async syncS3PathsOnRename(file: TFile, oldPath: string): Promise<void> {
    const result = await this.syncS3PathsForNote(file, oldPath, false);
    if (result.fixed > 0) new Notice(this.t("s3PathSynced", { count: result.fixed }));
  }

  private addPathReplacements(
    context: PathMigrationContext,
    replacements: Map<string, string>,
    owners: Map<string, string>,
    noteText: string,
    oldKey: string,
    newKey: string
  ): void {
    const add = (oldValue: string, newValue: string): void => {
      if (!oldValue || oldValue === newValue || !noteText.includes(oldValue)) return;
      replacements.set(oldValue, newValue);
      owners.set(oldValue, oldKey);
    };
    const oldUrl = buildPublicUrl(
      context.s3.customDomainName,
      context.s3.endpoint,
      context.s3.bucketName,
      oldKey
    );
    const newUrl = buildPublicUrl(
      context.s3.customDomainName,
      context.s3.endpoint,
      context.s3.bucketName,
      newKey
    );
    add(oldUrl, newUrl);
    for (const ref of extractRemoteImageRefs(noteText)) {
      if (this.remoteUrlToS3Key(ref.url) === oldKey) {
        add(ref.url, newUrl);
      }
    }
    const oldLocalPath = this.getLocalMirrorPathForCloudKey(oldKey, context.mirrorRoot);
    const newLocalPath = this.getLocalMirrorPathForCloudKey(newKey, context.mirrorRoot);
    if (!oldLocalPath || !newLocalPath) return;
    add(oldLocalPath, newLocalPath);
    add(
      oldLocalPath.split("/").map(encodeURIComponent).join("/"),
      newLocalPath.split("/").map(encodeURIComponent).join("/")
    );
    const mirrorRoot = trimSlashes(context.mirrorRoot || "98 cloudflareR2");
    for (const ref of extractLocalRefs(noteText)) {
      let decodedTarget = ref.target;
      try {
        decodedTarget = decodeURIComponent(ref.target);
      } catch {
        // Keep the literal target.
      }
      if (cloudKeyFromLocalMirrorPath(decodedTarget, mirrorRoot) !== oldKey) continue;
      const target = ref.target.includes("%")
        ? newLocalPath.split("/").map(encodeURIComponent).join("/")
        : newLocalPath;
      add(ref.target, target);
    }
  }

  private isPathMigrationContextCurrent(context: PathMigrationContext, file: TFile): boolean {
    return this.settings.enabled &&
      file.path === context.targetNotePath &&
      canPathSync(this.getNotePathMode(file.path)) &&
      this.settings.s3.pathTemplate === context.pathTemplate &&
      this.settings.s3.customDomainName === context.s3.customDomainName &&
      this.getStorageIdentity() === context.storageIdentity;
  }

  private async readOldMirrorForMigration(
    context: PathMigrationContext,
    oldKey: string
  ): Promise<{ body: Uint8Array; hash: string; contentType: string } | null> {
    const oldPath = this.findLocalMirrorForCloudKey(oldKey, trimSlashes(context.mirrorRoot));
    if (!oldPath) return null;
    const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
    if (!(oldFile instanceof TFile)) return null;
    const body = new Uint8Array(await this.app.vault.readBinary(oldFile));
    return {
      body,
      hash: await sha256Hex(body),
      contentType: contentTypeForExt(oldFile.extension.toLowerCase()),
    };
  }

  private async preparePathMigration(
    context: PathMigrationContext,
    file: TFile,
    oldKey: string,
    newKey: string
  ): Promise<PreparedPathMigration> {
    if (!this.isPathMigrationContextCurrent(context, file)) {
      throw new Error(this.t("pathNoLongerManaged"));
    }

    const source = await this.readVerifiedCloudObject(context.s3, oldKey);
    let target = await this.readVerifiedCloudObject(context.s3, newKey);
    let recoverySource = source;
    if (!recoverySource) {
      const oldMirror = await this.readOldMirrorForMigration(context, oldKey);
      if (oldMirror) {
        recoverySource = {
          body: oldMirror.body,
          hash: oldMirror.hash,
          contentType: oldMirror.contentType,
          operationId: null,
          etag: null,
        };
        if (target && target.hash !== oldMirror.hash) {
          throw new Error(`Cloud object collision: ${newKey}`);
        }
      }
    }
    if (!recoverySource) {
      throw new Error(`Source object and local mirror are both missing: ${oldKey}`);
    }

    if (source && target && source.hash !== target.hash) {
      throw new Error(`Cloud object collision: ${newKey}`);
    }

    let createdTarget = false;
    if (!target) {
      if (!this.isPathMigrationContextCurrent(context, file)) {
        throw new Error(this.t("pathNoLongerManaged"));
      }
      const ext = (newKey.split(".").pop() || "bin").toLowerCase();
      const putResult = await putS3Object(
        context.s3,
        newKey,
        recoverySource.body,
        recoverySource.contentType || contentTypeForExt(ext),
        (status, text) => this.t("uploadFailed", { status, text }),
        recoverySource.hash,
        { ifNoneMatch: true }
      );
      target = await this.readVerifiedCloudObject(context.s3, newKey);
      if (!target || target.hash !== recoverySource.hash) {
        throw new Error(`Target object verification failed: ${newKey}`);
      }
      createdTarget = isPutOwnershipConfirmed(putResult, target.hash, target.operationId);
    }

    const newLocalPath = this.getLocalMirrorPathForCloudKey(newKey, context.mirrorRoot);
    if (!newLocalPath || !target) throw new Error(`Local mirror path is invalid: ${newKey}`);
    const parentDir = newLocalPath.substring(0, newLocalPath.lastIndexOf("/"));
    if (parentDir) await this.ensureFolderExists(parentDir);
    const existingLocal = this.app.vault.getAbstractFileByPath(newLocalPath);
    let localMatches = false;
    if (existingLocal instanceof TFile && existingLocal.stat.size === target.body.byteLength) {
      const localHash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(existingLocal)));
      localMatches = localHash === target.hash;
    }
    if (!localMatches) {
      const binary = target.body.buffer.slice(
        target.body.byteOffset,
        target.body.byteOffset + target.body.byteLength
      );
      if (existingLocal instanceof TFile) {
        await this.app.vault.modifyBinary(existingLocal, binary);
      } else {
        await this.app.vault.createBinary(newLocalPath, binary);
      }
    }
    const saved = this.app.vault.getAbstractFileByPath(newLocalPath);
    if (!(saved instanceof TFile)) throw new Error(`Local mirror was not created: ${newLocalPath}`);
    const savedHash = await sha256Hex(new Uint8Array(await this.app.vault.readBinary(saved)));
    if (savedHash !== target.hash) throw new Error(`Local mirror hash verification failed: ${newLocalPath}`);

    return {
      createdTarget,
      contentSha256: target.hash,
      size: target.body.byteLength,
      operationId: target.operationId,
      etag: target.etag,
    };
  }

  private async syncS3PathsForNote(
    file: TFile,
    sourceNotePath: string,
    showNotice: boolean
  ): Promise<{ fixed: number; skipped: number; failed: number }> {
    if (!this.settings.enabled || !canPathSync(this.getNotePathMode(file.path))) {
      return { fixed: 0, skipped: 0, failed: 0 };
    }
    try {
      this.ensureS3Settings();
    } catch {
      return { fixed: 0, skipped: 0, failed: 0 };
    }
    if (!this.usesCanonicalNotePathTemplate()) return { fixed: 0, skipped: 0, failed: 0 };

    const context: PathMigrationContext = {
      s3: { ...this.settings.s3 },
      mirrorRoot: this.settings.localMirrorRoot,
      storageIdentity: this.getStorageIdentity(),
      targetNotePath: file.path,
      pathTemplate: this.settings.s3.pathTemplate,
    };

    const text = await this.app.vault.read(file);
    const remoteKeys = this.extractRemoteUrls(text);
    const replacements = new Map<string, string>();
    const replacementOwners = new Map<string, string>();
    const migrated: Array<{
      oldKey: string;
      newKey: string;
      prepared: PreparedPathMigration;
      lockKeys: string[];
    }> = [];
    const heldKeys = new Set<string>();
    let skipped = 0;
    let failed = 0;

    for (const oldKey of remoteKeys) {
      if (this.isExcludedFromPathSync(oldKey)) {
        skipped++;
        continue;
      }
      const newKey = this.getCanonicalKeyForNote(oldKey, file);
      if (!newKey || newKey === oldKey) continue;
      const acquiredKeys: string[] = [];
      try {
        for (const key of [...new Set([oldKey, newKey])].sort()) {
          if (heldKeys.has(key)) continue;
          this.reserveKeyOperation(key);
          heldKeys.add(key);
          acquiredKeys.push(key);
        }
        const prepared = await this.preparePathMigration(context, file, oldKey, newKey);
        const replacementCountBefore = replacements.size;
        this.addPathReplacements(context, replacements, replacementOwners, text, oldKey, newKey);
        if (replacements.size === replacementCountBefore) {
          for (const key of acquiredKeys) {
            heldKeys.delete(key);
            this.releaseKeyOperation(key);
          }
          failed++;
          continue;
        }
        migrated.push({ oldKey, newKey, prepared, lockKeys: acquiredKeys });
      } catch {
        for (const key of acquiredKeys) {
          heldKeys.delete(key);
          this.releaseKeyOperation(key);
        }
        failed++;
      }
    }

    try {
      if (replacements.size === 0) return { fixed: 0, skipped, failed };
      if (!this.isPathMigrationContextCurrent(context, file)) {
        return { fixed: 0, skipped, failed: failed + migrated.length };
      }
      const appliedOldKeys = new Set<string>();
      await this.app.vault.process(file, (content) => {
        if (!this.isPathMigrationContextCurrent(context, file)) {
          throw new Error(this.t("pathNoLongerManaged"));
        }
        let next = content;
        for (const [oldValue, newValue] of replacements) {
          if (!next.includes(oldValue)) continue;
          next = replaceAllLiteral(next, oldValue, newValue);
          const owner = replacementOwners.get(oldValue);
          if (owner) appliedOldKeys.add(owner);
        }
        return next;
      });

      if (!this.isPathMigrationContextCurrent(context, file)) {
        return { fixed: 0, skipped, failed: failed + migrated.length };
      }
      const appliedMigrations = migrated.filter((migration) => appliedOldKeys.has(migration.oldKey));
      failed += migrated.length - appliedMigrations.length;
      for (const migration of appliedMigrations) {
        if (migration.prepared.createdTarget) {
          this.rememberOwnedObjectKey(
            migration.newKey,
            context.storageIdentity,
            migration.prepared.contentSha256,
            migration.prepared.size,
            migration.prepared.operationId,
            migration.prepared.etag
          );
        }
        this.schedulePendingDelete(
          sourceNotePath,
          [migration.oldKey],
          "path-migration",
          file.path,
          context.storageIdentity
        );
      }
      await this.cacheRemoteUrls(file);
      await this.saveSettings();
      if (showNotice && appliedMigrations.length > 0) {
        new Notice(this.t("s3PathSynced", { count: appliedMigrations.length }));
      }
      return { fixed: appliedMigrations.length, skipped, failed };
    } finally {
      for (const key of heldKeys) this.releaseKeyOperation(key);
    }
  }

  // ─── Startup Path Integrity Check ──────────────────────────────────

  private async startupPathIntegrityCheck(): Promise<void> {
    if (!this.settings.enabled) return;
    try {
      this.ensureS3Settings();
    } catch { return; }
    if (!this.usesCanonicalNotePathTemplate()) return;

    const files = this.app.vault.getMarkdownFiles();
    let mismatchCount = 0;
    let verifyOnlyMismatchCount = 0;

    for (const file of files) {
      const mode = this.getNotePathMode(file.path);
      if (!canCheckPath(mode)) continue;
      try {
        const text = await this.app.vault.read(file);
        const cloudKeys = this.extractRemoteUrls(text);
        if (cloudKeys.length === 0) continue;

        for (const key of cloudKeys) {
          if (this.isExcludedFromPathSync(key)) continue;
          const expectedKey = this.getCanonicalKeyForNote(key, file);
          if (expectedKey && expectedKey !== key) {
            if (canPathSync(mode)) mismatchCount++;
            else verifyOnlyMismatchCount++;
            break; // One mismatch per note is enough
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (mismatchCount > 0) {
      new Notice(this.t("resyncStartupNotice", { count: mismatchCount }), 15000);
    }
    if (verifyOnlyMismatchCount > 0) {
      new Notice(this.t("auditStartupNotice", { count: verifyOnlyMismatchCount }), 15000);
    }
  }

  // ─── Re-sync All S3 Paths ─────────────────────────────────────────

  async resyncAllS3Paths(): Promise<void> {
    if (!this.settings.enabled) {
      new Notice(this.t("disabled"));
      return;
    }
    try {
      this.ensureS3Settings();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!this.usesCanonicalNotePathTemplate()) {
      new Notice(this.t("resyncUnsupportedTemplate"), 10000);
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    const notice = new Notice(this.t("resyncScanning", { current: 0, total: files.length }), 0);

    let fixed = 0;
    let skipped = 0;
    let failed = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!canPathSync(this.getNotePathMode(file.path))) continue;
      if (index % 10 === 0) {
        notice.setMessage(this.t("resyncProgress", { current: index, total: files.length }));
      }
      try {
        const result = await this.syncS3PathsForNote(file, file.path, false);
        fixed += result.fixed;
        skipped += result.skipped;
        failed += result.failed;
      } catch {
        failed++;
      }
    }

    notice.hide();
    if (fixed === 0 && failed === 0) {
      new Notice(this.t("resyncNoMismatch"));
    } else {
      new Notice(this.t("resyncDone", { fixed, skipped, failed }), 10000);
    }
  }
}
