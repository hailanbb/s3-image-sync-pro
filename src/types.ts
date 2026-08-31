import { TFile } from "obsidian";
import type { PathPolicyRule, ProcessingScopeMode } from "./path-policy";

export type S3Provider = "r2" | "s3" | "minio" | "custom";
export type ReplacementType = "image" | "markdown" | "audio" | "video";

export interface S3Config {
  provider: S3Provider;
  endpoint: string;
  region: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  customDomainName: string;
  pathTemplate: string;
}

export interface PluginSettings {
  enabled: boolean;
  autoScanEnabled: boolean;
  scanIntervalMinutes: number;
  quietSeconds: number;
  autoScanMinSizeMiB: number;
  attachmentRoot: string;
  s3: S3Config;
  enabledExtensions: string[];
  minSizeRules: Record<string, number>;
  autoCandidateExts: string[];
  customExtensions: string[];
  customReplacements: Record<string, ReplacementType>;
  webpEnabled: boolean;
  webpQuality: number;
  webpSkipFormats: string[];
  deleteRemoteOnNoteDelete: boolean;
  autoUploadOnPaste: boolean;
  autoTransferRemoteImages: boolean;
  trashOriginalAfterUpload: boolean;
  remoteImageMaxSizeMiB: number;
  syncS3OnNoteMove: boolean;
  deleteOldObjectAfterPathMigration: boolean;
  localMirrorRoot: string;
  /** Public URL prefixes, each bound to the exact storage identity that owned it. */
  recognizedCloudDomains: RecognizedCloudDomainRecord[];
  processingScopeMode: ProcessingScopeMode;
  pathPolicies: PathPolicyRule[];
  excludedNotePaths: string[];
  excludedPathSyncKeyPrefixes: string[];
  startupCatchupEnabled: boolean;
  /** Notes that still need one successful startup catch-up pass. */
  startupCatchupPendingPaths: string[];
  deleteGraceMinutes: number;
  pruneEmptyMirrorFolders: boolean;
  noteSyncIndex: Record<string, NoteSyncSnapshot>;
  pendingDeleteQueue: PendingDeleteRecord[];
  ownedObjectKeys: OwnedObjectRecord[];
  linkMode: "local" | "cloud";
  logs: LogEntry[];
}

export interface NoteSyncSnapshot {
  mtime: number;
  size: number;
  keys: string[];
  storageIdentity?: string;
}

export interface RecognizedCloudDomainRecord {
  prefix: string;
  storageIdentity: string;
}

export interface PendingDeleteRecord {
  id: string;
  notePath: string;
  authorizationPath?: string;
  storageIdentity?: string;
  keys: string[];
  dueAt: number;
  reason: "note-delete" | "startup-missing" | "path-migration";
  attempts: number;
  expectedVersions?: Record<string, ObjectVersionRecord>;
  inFlight?: PendingDeleteOperation;
}

export interface OwnedObjectRecord {
  key: string;
  storageIdentity: string;
  contentSha256?: string;
  size?: number;
  /** Operation metadata written by this exact create-only PUT. Missing on legacy/external objects. */
  operationId?: string;
  /** ETag observed immediately after the owned PUT. Missing records are never auto-deleted. */
  etag?: string;
}

export interface ObjectVersionRecord {
  contentSha256: string;
  size: number;
  operationId: string;
  etag: string;
}

export interface PendingDeleteOperation extends ObjectVersionRecord {
  key: string;
  startedAt: number;
}

export interface LocalRef {
  kind: "wiki" | "wiki-embed" | "markdown" | "markdown-embed";
  raw: string;
  start: number;
  end: number;
  target: string;
  fragment: string;
  label: string;
}

export interface RemoteImageRef {
  raw: string;
  start: number;
  end: number;
  url: string;
  alt: string;
}

export interface RemoteCandidate {
  url: string;
  alt: string;
  guessedExt: string;
  refs: RemoteImageRef[];
}

export interface Candidate {
  file: TFile;
  ext: string;
  replacement: ReplacementType;
  refs: LocalRef[];
  referenceCount: number;
  sizeBytes: number;
  /** Exact S3 key when the source file already lives inside the local mirror. */
  mirrorCloudKey?: string;
}



export interface LogEntry {
  time: string;
  status: string;
  notePath: string;
  sourcePath: string;
  remoteUrl: string;
  trashed?: boolean;
}

export interface ProgressState {
  phase: "uploading" | "uploaded" | "rewriting" | "trashing" | "scheduling" | "downloading" | "done";
  current: number;
  total: number;
  label: string;
}

export interface UploadResult {
  key: string;
  publicUrl: string;
  localPath?: string;
  /** Held until the note link/index transaction finishes. */
  operationLockKey?: string;
  targetNotePath?: string;
}

export interface LocalFileRecord {
  path: string;
  name: string;
  remoteUrl: string;
}

export interface ReplaceResult {
  replaced: number;
  localFiles?: LocalFileRecord[];
}

export interface ScanOptions {
  requireAutoCandidate: boolean;
  enforceAttachmentRoot: boolean;
  enforceSizeRule: boolean;
  skipExtensionFilter?: boolean;
  includeLocalMirror?: boolean;
}

export interface FileCategory {
  id: string;
  nameKey: string;
  replacement: ReplacementType;
  extensions: string[];
}
