import { Notice, Platform, Plugin, TFile, TFolder, getLanguage, Editor, MarkdownView, MarkdownFileInfo, requestUrl, Menu } from "obsidian";
import {
  Candidate,
  LocalFileRecord,
  LocalRef,
  LogEntry,
  PluginSettings,
  ProgressState,
  RemoteCandidate,
  ReplaceResult,
  ScanOptions,
  UploadResult,
} from "./types";
import { DEFAULT_SETTINGS, getReplacementForExt, mergeSettings } from "./settings";
import { extractLocalRefs, extractRemoteImageRefs, guessExtFromUrl } from "./link-parser";
import { putS3Object, deleteS3Object, copyS3Object } from "./s3-client";
import { sha256Hex } from "./crypto";
import {
  buildPublicUrl,
  contentTypeForExt,
  escapeMarkdownLabel,
  renderPathTemplate,
  replaceAllLiteral,
  safeFilename,
  trimSlashes,
} from "./utils";
import { detectLocaleFromApp, t as translate } from "./i18n";
import { CandidateModal } from "./candidate-modal";
import { DryRunModal } from "./dry-run-modal";
import { compressToWebp, setWasmLoader } from "./image-compressor";
import { S3ImageSyncSettingTab } from "./settings-tab";
import { LinkToggleModal } from "./link-toggle-modal";

export default class S3ImageSyncPlugin extends Plugin {
  declare settings: PluginSettings;
  locale!: string;
  autoScanTimer: number | null = null;
  isMobile: boolean = false;
  private noteRemoteUrls: Map<string, string[]> = new Map();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.locale = detectLocaleFromApp(getLanguage);
    this.isMobile = Platform.isMobile;

    // Initialize WASM file path for image compression
    setWasmLoader(async (filename: string) => {
      return await this.app.vault.adapter.readBinary(`${this.manifest.dir}/${filename}`);
    });

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

    this.addSettingTab(new S3ImageSyncSettingTab(this.app, this));
    // Cache remote URLs for note-delete sync
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.cacheRemoteUrls(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.handleNoteDelete(file.path);
        } else if (file instanceof TFolder) {
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
    // Initialize cache for existing notes
    if (this.settings.deleteRemoteOnNoteDelete) {
      void this.initRemoteUrlCache();
    }
    this.configureAutoScan();
    this.configureAutoRemoteTransfer();
    // Sync S3 paths when note is moved/renamed
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.syncS3OnNoteMove) {
          void this.syncS3PathsOnRename(file, oldPath);
        }
      })
    );
  }

  onunload(): void {
    if (this.autoScanTimer) window.clearInterval(this.autoScanTimer);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Record<string, unknown> | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, loaded || {});
  }

  async saveSettings(): Promise<void> {
    const toSave: Record<string, unknown> = { ...this.settings };
    toSave.logs = this.settings.logs.slice(0, 50);
    await this.saveData(toSave);
  }

  t(key: string, params: Record<string, unknown> = {}): string {
    return translate(this.locale, key, params);
  }

  configureAutoScan(): void {
    if (this.autoScanTimer) window.clearInterval(this.autoScanTimer);
    this.autoScanTimer = null;
    if (this.isMobile) return;
    if (!this.settings.enabled || !this.settings.autoScanEnabled) return;
    const minutes = Math.max(1, Number(this.settings.scanIntervalMinutes) || 30);
    this.autoScanTimer = window.setInterval(() => {
      this.runAutoScan().catch((error) => {
        console.error("Auto scan failed", error);
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
      } catch (error) {
        console.error(`Dry-run scan error for ${file.path}:`, error);
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
        });
        const quietCandidates = candidates.filter((c) => {
          if (!this.isQuiet(c.file)) return false;
          if (minBytes > 0 && c.sizeBytes < minBytes) return false;
          return true;
        });
        if (quietCandidates.length === 0) continue;
        const result = await this.replaceCandidates(file, quietCandidates, null);
        replaced += result.replaced;
      } catch (error) {
        console.error(`Auto-scan error for ${file.path}:`, error);
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
    const text = await this.app.vault.read(noteFile);
    const refs = extractLocalRefs(text);
    const byKey = new Map<string, Candidate>();

    for (const ref of refs) {
      const targetFile = this.resolveLinkedFile(ref.target, noteFile);
      if (!targetFile || !(targetFile instanceof TFile)) continue;
      if (options.enforceAttachmentRoot !== false && !this.isUnderAttachmentRoot(targetFile))
        continue;
      if (this.isCoverReference(text, ref)) continue;

      const ext = targetFile.extension.toLowerCase();
      if (ext === "md") continue;
      if (!options.skipExtensionFilter && !this.settings.enabledExtensions.includes(ext)) continue;
      if (options.requireAutoCandidate && !this.settings.autoCandidateExts.includes(ext))
        continue;
      if (options.enforceSizeRule !== false && !this.meetsSizeRule(targetFile, ext)) continue;

      const replacement = getReplacementForExt(ext, this.settings);
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
    const root = trimSlashes(this.settings.attachmentRoot || "90-笔记系统/92-附件");
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
    progress: ((state: ProgressState) => void) | null
  ): Promise<ReplaceResult> {
    this.ensureS3Settings();
    let noteChanged = false;
    let replaced = 0;
    const replacementMap = new Map<string, string>();
    const uploaded = new Map<string, UploadResult>();
    const uploadedKeys: string[] = [];
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
          uploadedKeys.push(upload.key);
          completedUploads += 1;
          progress?.({
            phase: "uploaded",
            current: completedUploads,
            total: uniqueFiles,
            label: candidate.file.name,
          });
        }
        for (const ref of candidate.refs) {
          const targetUrl = (this.settings.linkMode === "local" && upload.localPath) 
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
    } catch (error) {
      for (const key of uploadedKeys) {
        await deleteS3Object(this.settings.s3, key).catch(() => {});
      }
      throw error;
    }

    if (!noteChanged) return { replaced: 0 };

    const localFiles = this.buildLocalFileRecords(candidates, uploaded);
    for (const candidate of candidates) replaced += candidate.refs.length;

    if (localFiles.length > 0) {
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
          if (!(e instanceof Error) || !e.message?.includes("Folder already exists")) {
            console.warn(`Failed to create folder ${current}:`, e);
          }
        }
      }
    }
  }

  async uploadBuffer(binary: ArrayBuffer, originalName: string, noteFile?: TFile, originalFilePath?: string): Promise<UploadResult> {
    let body = new Uint8Array(binary);
    const hash = await sha256Hex(body);
    
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
        console.warn(`WebP compression failed for ${originalName}, uploading original:`, error);
      }
    }

    const noteDir = noteFile?.parent?.path || "";
    const noteName = noteFile?.basename || "";
    const key = renderPathTemplate(this.settings.s3.pathTemplate, {
      ext,
      hash,
      hash2: hash.slice(0, 2),
      filename: safeFilename(originalName.replace(/\.[^/.]+$/, "")),
      notedir: noteDir,
      notename: noteName,
    });
    // ── Check if already exists in local mirror (skip upload) ──
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    let localPath: string | undefined;
    if (mirrorRoot) {
      const keyStem = key.replace(/\.[^/.]+$/, "");
      localPath = `${mirrorRoot}/${keyStem}.${originalExt}`;
      const existing = this.app.vault.getAbstractFileByPath(localPath);
      if (existing instanceof TFile) {
        if (existing.path !== originalFilePath) {
          // Fast path: file already exists locally (and it is not the very file we are uploading), assume it's also in S3
          const publicUrl = buildPublicUrl(this.settings.s3.customDomainName, this.settings.s3.endpoint, this.settings.s3.bucketName, key);
          return { key, publicUrl, localPath };
        }
      }
    }

    await putS3Object(
      this.settings.s3,
      key,
      body,
      contentType,
      (status, text) => this.t("uploadFailed", { status, text }),
      hash
    );

    const publicUrl = buildPublicUrl(this.settings.s3.customDomainName, this.settings.s3.endpoint, this.settings.s3.bucketName, key);

    if (mirrorRoot && localPath) {
      try {
        // Ensure parent directories exist
        const parentDir = localPath.substring(0, localPath.lastIndexOf("/"));
        if (parentDir) {
          await this.ensureFolderExists(parentDir);
        }
        // Write original binary (not the WebP compressed one)
        const existing = this.app.vault.getAbstractFileByPath(localPath);
        if (existing instanceof TFile) {
          await this.app.vault.modifyBinary(existing, binary);
        } else {
          await this.app.vault.createBinary(localPath, binary);
        }
      } catch (error) {
        console.warn(`Failed to write local mirror at ${localPath}:`, error);
        localPath = undefined; // don't return a broken localPath
      }
    }

    return { key, publicUrl, localPath };
  }

  async uploadCandidate(candidate: Candidate, noteFile?: TFile): Promise<UploadResult> {
    const binary = await this.app.vault.readBinary(candidate.file);
    return this.uploadBuffer(binary, candidate.file.name, noteFile, candidate.file.path);
  }

  buildReplacement(ref: LocalRef, candidate: Candidate, publicUrl: string): string {
    const encodedBase = publicUrl;
    const url = ref.fragment
      ? `${encodedBase}#${encodeURIComponent(ref.fragment)}`
      : encodedBase;
    const label = ref.label || candidate.file.basename;

    if (candidate.replacement === "image")
      return `![${escapeMarkdownLabel(label)}](${url})`;
    if (candidate.replacement === "video")
      return `<video src="${url}" controls></video>`;
    if (candidate.replacement === "audio")
      return `<audio src="${url}" controls></audio>`;
    return `[${escapeMarkdownLabel(label)}](${url})`;
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
      try {
        await this.app.fileManager.trashFile(file);
      } catch (e) {
        console.warn(`Trash failed for ${file.path}, maybe already deleted or locked:`, e);
      }
      this.addLog({
        status,
        notePath: noteFile.path,
        sourcePath: fileRecord.path,
        remoteUrl: fileRecord.remoteUrl,
        trashed: true,
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
    let base = String(s3.customDomainName || "").replace(/\/+$/, "");
    if (!base) {
      let cleanEndpoint = String(s3.endpoint || "").replace(/\/+$/, "");
      if (cleanEndpoint && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleanEndpoint)) {
        cleanEndpoint = `https://${cleanEndpoint}`;
      }
      base = `${cleanEndpoint}/${s3.bucketName}`;
    } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base)) {
      base = `https://${base}`;
    }
    return base;
  }

  extractRemoteUrls(text: string): string[] {
    const keys: string[] = [];
    const domainPrefix = this.getCloudUrlPrefix();
    if (!domainPrefix) return keys;

    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    
    // find all ![...](url)
    const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const url = match[1];
      if (url.startsWith(domainPrefix)) {
        keys.push(this.remoteUrlToS3Key(url));
      } else if (mirrorRoot) {
        // The URL in note text may be URL-encoded (e.g., "98%20cloudflareR2" vs "98 cloudflareR2")
        // Decode first to compare against the raw mirrorRoot
        const decodedUrl = decodeURIComponent(url);
        if (decodedUrl.startsWith(mirrorRoot)) {
          try {
            const relativePath = decodedUrl.substring(mirrorRoot.length + 1);
            const stem = relativePath.replace(/\.[^/.]+$/, "");
            const cloudExt = this.guessCloudExt(relativePath);
            keys.push(`${stem}.${cloudExt}`);
          } catch {
            // Ignore decode errors
          }
        }
      }
    }
    return [...new Set(keys)];
  }

  remoteUrlToS3Key(url: string): string {
    const prefix = this.getCloudUrlPrefix();
    const key = url.slice(prefix.length + 1); // +1 for the '/' after prefix
    return decodeURIComponent(key);
  }

  async cacheRemoteUrls(file: TFile): Promise<void> {
    if (!this.settings.deleteRemoteOnNoteDelete) return;
    try {
      const text = await this.app.vault.read(file);
      const urls = this.extractRemoteUrls(text);
      const oldUrls = this.noteRemoteUrls.get(file.path) || [];

      // Detect URLs that were removed from the note and clean them up
      const removedUrls = oldUrls.filter((u) => !urls.includes(u));
      if (removedUrls.length > 0) {
        const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
        for (const key of removedUrls) {
          // Delete from S3
          try {
            await deleteS3Object(this.settings.s3, key);
          } catch (e) {
            console.warn(`Failed to delete orphan S3 object ${key}:`, e);
          }
          // Delete from local mirror
          if (mirrorRoot) {
            const stem = key.replace(/\.[^/.]+$/, "");
            const exts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tiff", "avif"];
            for (const ext of exts) {
              const localPath = `${mirrorRoot}/${stem}.${ext}`;
              const localFile = this.app.vault.getAbstractFileByPath(localPath);
              if (localFile) {
                try { await this.app.fileManager.trashFile(localFile); } catch { /* ignore */ }
                break;
              }
            }
          }
        }
      }

      if (urls.length > 0) {
        this.noteRemoteUrls.set(file.path, urls);
      } else {
        this.noteRemoteUrls.delete(file.path);
      }
    } catch {
      // File might not be readable
    }
  }

  async initRemoteUrlCache(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      await this.cacheRemoteUrls(file);
    }
  }

  async handleFolderDelete(folderPath: string): Promise<void> {
    const notesToDelete: string[] = [];
    for (const notePath of this.noteRemoteUrls.keys()) {
      if (notePath.startsWith(folderPath + "/")) {
        notesToDelete.push(notePath);
      }
    }
    for (const notePath of notesToDelete) {
      await this.handleNoteDelete(notePath);
    }
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (mirrorRoot) {
      const localFolder = `${mirrorRoot}/${folderPath}`;
      const existing = this.app.vault.getAbstractFileByPath(localFolder);
      if (existing instanceof TFolder) {
        await this.app.fileManager.trashFile(existing).catch(() => {});
      }
    }
  }

  async handleNoteDelete(notePath: string): Promise<void> {
    // 1. Always cleanup local mirror directory for this note!
    await this.cleanupLocalMirrorForNote(notePath);

    if (!this.settings.deleteRemoteOnNoteDelete) return;
    const keys = this.noteRemoteUrls.get(notePath);
    if (!keys || keys.length === 0) return;
    this.noteRemoteUrls.delete(notePath);

    for (const key of keys) {
      try {
        await deleteS3Object(this.settings.s3, key);
        this.addLog({
          status: "remote-deleted-on-note-delete",
          notePath,
          sourcePath: "",
          remoteUrl: key, // Log the key
          trashed: false,
        });
      } catch (error) {
        console.error(`Failed to delete remote object for ${key}:`, error);
        this.addLog({
          status: "remote-delete-failed",
          notePath,
          sourcePath: "",
          remoteUrl: key,
          trashed: false,
        });
      }
    }
    await this.saveSettings();
  }

  private async onEditorPaste(evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): Promise<void> {
    if (!this.settings.enabled || !this.settings.autoUploadOnPaste) return;
    
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
    await this.handlePastedImages(images, editor, info.file);
  }

  private async onEditorDrop(evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): Promise<void> {
    if (!this.settings.enabled || !this.settings.autoUploadOnPaste) return;
    
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
    await this.handlePastedImages(images, editor, info.file);
  }

  private async handlePastedImages(images: File[], editor: Editor, noteFile: TFile | null): Promise<void> {
    for (const file of images) {
      const placeholderId = Math.random().toString(36).substring(2, 8);
      const originalName = file.name || "image.png";
      const placeholder = `![Uploading ${originalName} ${placeholderId}...]()`;
      editor.replaceSelection(placeholder + "\n");
      
      try {
        const buffer = await file.arrayBuffer();
        // If pasting into an unsaved new note, use the active file or fallback to a default directory
        const effectiveNoteFile = noteFile || this.app.workspace.getActiveFile() || undefined;
        const result = await this.uploadBuffer(buffer, originalName, effectiveNoteFile);
        const targetUrl = (this.settings.linkMode === "local" && result.localPath) 
          ? result.localPath.split("/").map(encodeURIComponent).join("/") 
          : result.publicUrl;
        const replacement = `![${escapeMarkdownLabel(originalName)}](${targetUrl})`;
        
        for (let i = 0; i < editor.lineCount(); i++) {
          const line = editor.getLine(i);
          if (line.includes(placeholder)) {
            editor.setLine(i, replaceAllLiteral(line, placeholder, replacement));
            break;
          }
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
      }
    }
  }

  // ─── Remote Image Transfer ───────────────────────────────────────────

  async findRemoteCandidatesInNote(noteFile: TFile): Promise<RemoteCandidate[]> {
    const text = await this.app.vault.read(noteFile);
    const refs = extractRemoteImageRefs(text);
    // Filter out URLs already on our own S3 domain
    const ownDomain = (this.settings.s3.customDomainName || "").replace(/\/+$/, "").toLowerCase();
    const filtered = refs.filter((ref) => {
      if (!ownDomain) return true;
      try {
        const refHost = new URL(ref.url).origin.toLowerCase();
        const ownHost = ownDomain.includes("://") ? new URL(ownDomain).origin.toLowerCase() : ownDomain;
        return !refHost.includes(ownHost.replace(/^https?:\/\//, ""));
      } catch {
        return true;
      }
    });
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
    this.ensureS3Settings();
    const replacementMap = new Map<string, string>();
    let replaced = 0;
    const total = candidates.length;
    let completed = 0;

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
        console.warn(`Failed to transfer remote image ${candidate.url}:`, error);
        new Notice(this.t("downloadFailed", { error: error instanceof Error ? error.message : String(error) }));
        completed++;
        // Continue with other candidates
      }
    }

    if (replacementMap.size === 0) return { replaced: 0 };

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
  }

  private remoteTransferDebounceTimers = new Map<string, number>();

  configureAutoRemoteTransfer(): void {
    if (!this.settings.autoTransferRemoteImages) return;
    // Listen for note creation (e.g. Web Clipper)
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (!this.settings.autoTransferRemoteImages || !this.settings.enabled) return;
        // Debounce: wait 5 seconds for the file to settle
        const existing = this.remoteTransferDebounceTimers.get(file.path);
        if (existing) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
          this.remoteTransferDebounceTimers.delete(file.path);
          void this.autoTransferRemoteForFile(file);
        }, 5000);
        this.remoteTransferDebounceTimers.set(file.path, timer);
      })
    );
    // Also listen for modify (in case Web Clipper modifies an existing note)
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (!this.settings.autoTransferRemoteImages || !this.settings.enabled) return;
        const existing = this.remoteTransferDebounceTimers.get(file.path);
        if (existing) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
          this.remoteTransferDebounceTimers.delete(file.path);
          void this.autoTransferRemoteForFile(file);
        }, 5000);
        this.remoteTransferDebounceTimers.set(file.path, timer);
      })
    );
  }

  private async autoTransferRemoteForFile(file: TFile): Promise<void> {
    try {
      this.ensureS3Settings();
    } catch { return; }
    try {
      const candidates = await this.findRemoteCandidatesInNote(file);
      if (candidates.length === 0) return;
      const result = await this.transferRemoteImagesInNote(file, candidates);
      if (result.replaced > 0) {
        new Notice(this.t("remoteTransferNotice", { count: result.replaced }));
      }
    } catch (error) {
      console.error(`Auto remote transfer failed for ${file.path}:`, error);
    }
  }

  // ─── Link Mode Toggle ──────────────────────────────────────────────

  async executeToggleLinks(targetMode: "local" | "cloud", scope: "current" | "vault"): Promise<void> {
    const files = scope === "vault"
      ? this.app.vault.getMarkdownFiles()
      : [this.app.workspace.getActiveFile()].filter((f): f is TFile => f instanceof TFile && f.extension === "md");

    if (files.length === 0) {
      new Notice(this.t("openMarkdownFirst"));
      return;
    }

    let totalChanged = 0;
    const notice = new Notice(this.t("toggleLinkWorking"), 0);
    for (const file of files) {
      try {
        const changed = await this.toggleLinksInNote(file, targetMode);
        totalChanged += changed;
      } catch (error) {
        console.error(`Toggle links failed for ${file.path}:`, error);
      }
    }
    notice.hide();

    this.settings.linkMode = targetMode;
    await this.saveSettings();
    new Notice(this.t("toggleLinkDone", { count: totalChanged, mode: targetMode === "local" ? this.t("linkModeLocal") : this.t("linkModeCloud") }));
  }

  private async toggleLinksInNote(noteFile: TFile, targetMode: "local" | "cloud"): Promise<number> {
    const ownDomain = (this.settings.s3.customDomainName || "").replace(/\/+$/, "").toLowerCase();
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (!ownDomain || !mirrorRoot) return 0;

    // Normalize domain for matching
    const domainPrefix = ownDomain.includes("://") ? ownDomain : `https://${ownDomain}`;

    let changed = 0;
    await this.app.vault.process(noteFile, (content) => {
      let next = content;

      if (targetMode === "local") {
        // Cloud �?Local: find all URLs from our domain and replace with local paths
        const cloudRegex = new RegExp(
          `(!\\[[^\\]]*\\])\\(${this.escapeRegex(domainPrefix)}/([^)]+)\\)`,
          "g"
        );
        next = next.replace(cloudRegex, (_match, labelPart: string, cloudKeyEncoded: string) => {
          const cloudKey = decodeURIComponent(cloudKeyEncoded);
          const localFile = this.findLocalMirrorForCloudKey(cloudKey, mirrorRoot);
          if (localFile) {
            changed++;
            const encodedLocal = localFile.split("/").map(encodeURIComponent).join("/");
            return `${labelPart}(${encodedLocal})`;
          }
          return _match; // No local file found, keep cloud URL
        });
      } else {
        // Local → Cloud: find all paths starting with mirrorRoot and replace with cloud URLs
        // mirrorRoot may contain spaces; note text may have them URL-encoded as %20
        const mirrorPattern = this.escapeRegex(mirrorRoot).replace(/ /g, '(?: |%20)');
        const localRegex = new RegExp(
          `(!\\[[^\\]]*\\])\\(${mirrorPattern}/([^)]+)\\)`,
          "g"
        );
        next = next.replace(localRegex, (_match, labelPart: string, relativePathEncoded: string) => {
          // Decode first, because markdown URL might be URL-encoded (especially if it contains spaces)
          const relativePath = decodeURIComponent(relativePathEncoded);
          // Convert local extension to cloud extension
          const stem = relativePath.replace(/\.[^/.]+$/, "");
          const cloudExt = this.guessCloudExt(relativePath);
          const cloudKey = `${stem}.${cloudExt}`;
          const cloudUrl = buildPublicUrl(this.settings.s3.customDomainName, this.settings.s3.endpoint, this.settings.s3.bucketName, cloudKey);
          changed++;
          return `${labelPart}(${cloudUrl})`;
        });
      }

      return next;
    });

    return changed;
  }

  private findLocalMirrorForCloudKey(cloudKey: string, mirrorRoot: string): string | null {
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

  private guessCloudExt(localRelativePath: string): string {
    const localExt = (localRelativePath.split(".").pop() || "").toLowerCase();
    // If WebP compression is enabled and the format is not skipped, cloud uses webp
    if (this.settings.webpEnabled && !this.settings.webpSkipFormats.includes(localExt)) {
      return "webp";
    }
    return localExt;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ─── Cloud �?Local Migration ───────────────────────────────────────

  async downloadCloudToLocal(): Promise<void> {
    try {
      this.ensureS3Settings();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
      return;
    }

    const ownDomain = (this.settings.s3.customDomainName || "").replace(/\/+$/, "").toLowerCase();
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (!ownDomain || !mirrorRoot) {
      new Notice(this.t("migrationNoDomain"));
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    const notice = new Notice(this.t("migrationWorking"), 0);

    for (const file of files) {
      // Use extractRemoteUrls — already handles URL decoding and derives cloud keys
      const cloudKeys = this.extractRemoteUrls(await this.app.vault.read(file));
      for (const cloudKey of cloudKeys) {
        const localStem = cloudKey.replace(/\.[^/.]+$/, "");

        // Check if local mirror already exists (any extension)
        if (this.findLocalMirrorForCloudKey(cloudKey, mirrorRoot)) {
          skipped++;
          continue;
        }

        // Download from cloud
        const cloudUrl = buildPublicUrl(
          this.settings.s3.customDomainName,
          this.settings.s3.endpoint,
          this.settings.s3.bucketName,
          cloudKey
        );
        try {
          const response = await requestUrl({ url: cloudUrl, method: "GET", throw: false });
          if (response.status >= 400) {
            console.warn(`DownloadCloudToLocal: HTTP ${response.status} for ${cloudKey}`);
            failed++;
            continue;
          }

          const cloudExt = (cloudKey.split(".").pop() || "webp").toLowerCase();
          const localPath = `${mirrorRoot}/${localStem}.${cloudExt}`;

          const parentDir = localPath.substring(0, localPath.lastIndexOf("/"));
          if (parentDir) {
            await this.ensureFolderExists(parentDir);
          }
          await this.app.vault.createBinary(localPath, response.arrayBuffer);
          downloaded++;
          notice.setMessage(this.t("migrationProgress", { count: downloaded }));
        } catch (error) {
          console.warn(`Failed to download ${cloudKey}:`, error);
          failed++;
        }
      }
    }

    notice.hide();
    const msgParts = [`下载: ${downloaded}`, `跳过: ${skipped}`];
    if (failed > 0) msgParts.push(`失败: ${failed}`);
    new Notice(`迁移完成 — ${msgParts.join("  |  ")}`);
  }

  // ─── Note Delete �?Mirror Cleanup ──────────────────────────────────

  private async cleanupLocalMirrorForNote(notePath: string): Promise<void> {
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (!mirrorRoot) return;

    // Derive the note's mirror subdirectory
    const noteDir = notePath.substring(0, notePath.lastIndexOf("/")) || "";
    const noteName = notePath.substring(notePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
    const sanitizeDir = (d: string) => d.replace(/[\\:*?"<>|]+/g, "-");
    const sanitizeName = (n: string) => n.replace(/[\\/:*?"<>|#%]+/g, "-");
    const mirrorDir = noteDir
      ? `${mirrorRoot}/${sanitizeDir(noteDir)}/${sanitizeName(noteName)}`
      : `${mirrorRoot}/${sanitizeName(noteName)}`;

    const folder = this.app.vault.getAbstractFileByPath(mirrorDir);
    if (!(folder instanceof TFolder)) return;

    // Trash files individually — vault.trash on a TFolder calls fs.rename on every child,
    // which throws ENOENT if any file was already deleted externally.
    for (const child of folder.children) {
      try {
        await this.app.fileManager.trashFile(child);
      } catch {
        // File may already be missing — ignore
      }
    }
    // Trash the now-empty folder
    try {
      await this.app.fileManager.trashFile(folder);
    } catch {
      // Folder may already be gone
    }
  }

  // ─── S3 Path Sync on Note Rename ────────────────────────────────────

  private async syncS3PathsOnRename(file: TFile, oldPath: string): Promise<void> {
    try {
      this.ensureS3Settings();
    } catch { return; }

    const text = await this.app.vault.read(file);
    const remoteUrls = this.extractRemoteUrls(text);
    if (remoteUrls.length === 0) return;

    // Compute old/new notedir and notename
    const oldLastSlash = oldPath.lastIndexOf("/");
    const oldDir = oldLastSlash >= 0 ? oldPath.substring(0, oldLastSlash) : "";
    const oldName = (oldLastSlash >= 0 ? oldPath.substring(oldLastSlash + 1) : oldPath).replace(/\.md$/, "");
    const newDir = file.parent?.path || "";
    const newName = file.basename;

    // If neither directory nor name changed, nothing to do
    if (oldDir === newDir && oldName === newName) return;

    // Sanitize the same way renderPathTemplate does
    const sanitizeDir = (d: string) => d.replace(/[\\:*?"<>|]+/g, "-");
    const sanitizeName = (n: string) => n.replace(/[\\/:*?"<>|#%]+/g, "-");
    const safeOldDir = sanitizeDir(oldDir);
    const safeNewDir = sanitizeDir(newDir);
    const safeOldName = sanitizeName(oldName);
    const safeNewName = sanitizeName(newName);

    let movedCount = 0;
    const urlReplacements = new Map<string, string>();

    for (const url of remoteUrls) {
      const oldKey = this.remoteUrlToS3Key(url);
      let newKey = oldKey;

      // Replace notedir segment in the key
      if (safeOldDir !== safeNewDir) {
        if (safeOldDir && newKey.startsWith(safeOldDir + "/")) {
          newKey = safeNewDir + (safeNewDir ? "/" : "") + newKey.slice(safeOldDir.length + 1);
        } else if (!safeOldDir && safeNewDir) {
          // Note moved from vault root into a folder
          newKey = safeNewDir + "/" + newKey;
        } else if (safeOldDir && !safeNewDir) {
          // Note moved from folder to vault root
          newKey = newKey.slice(safeOldDir.length + 1);
        }
      }

      // Replace notename segment in the key
      if (safeOldName !== safeNewName) {
        // Find the notename as a path segment (between slashes or at start)
        const oldNameSegment = "/" + safeOldName + "/";
        const newNameSegment = "/" + safeNewName + "/";
        if (newKey.includes(oldNameSegment)) {
          newKey = newKey.replace(oldNameSegment, newNameSegment);
        } else if (newKey.startsWith(safeOldName + "/")) {
          newKey = safeNewName + "/" + newKey.slice(safeOldName.length + 1);
        }
      }

      if (newKey === oldKey) continue;

      try {
        await copyS3Object(this.settings.s3, oldKey, newKey);
        await deleteS3Object(this.settings.s3, oldKey);
        const newUrl = buildPublicUrl(
          this.settings.s3.customDomainName,
          this.settings.s3.endpoint,
          this.settings.s3.bucketName,
          newKey
        );
        urlReplacements.set(url, newUrl);
        movedCount++;
      } catch (error) {
        console.error(`Failed to move S3 object ${oldKey} -> ${newKey}:`, error);
      }
    }

    if (urlReplacements.size > 0) {
      await this.app.vault.process(file, (content) => {
        let next = content;
        for (const [oldUrl, newUrl] of urlReplacements) {
          next = replaceAllLiteral(next, oldUrl, newUrl);
        }
        return next;
      });
      await this.saveSettings();
      new Notice(this.t("s3PathSynced", { count: movedCount }));
    }

    // Also move local mirror directory
    const mirrorRoot = trimSlashes(this.settings.localMirrorRoot || "98 cloudflareR2");
    if (mirrorRoot) {
      const oldMirrorDir = oldDir
        ? `${mirrorRoot}/${sanitizeDir(oldDir)}/${sanitizeName(oldName)}`
        : `${mirrorRoot}/${sanitizeName(oldName)}`;
      const newMirrorDir = newDir
        ? `${mirrorRoot}/${sanitizeDir(newDir)}/${sanitizeName(newName)}`
        : `${mirrorRoot}/${sanitizeName(newName)}`;

      if (oldMirrorDir !== newMirrorDir) {
        const oldFolder = this.app.vault.getAbstractFileByPath(oldMirrorDir);
        if (oldFolder) {
          try {
            // Ensure new parent exists
            const newParent = newMirrorDir.substring(0, newMirrorDir.lastIndexOf("/"));
            if (newParent && !this.app.vault.getAbstractFileByPath(newParent)) {
              await this.app.vault.createFolder(newParent);
            }
            await this.app.vault.rename(oldFolder, newMirrorDir);
          } catch (error) {
            console.warn(`Failed to move mirror directory ${oldMirrorDir} -> ${newMirrorDir}:`, error);
          }
        }
      }
    }
  }
}

