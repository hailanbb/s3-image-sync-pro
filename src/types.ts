import { TFile } from "obsidian";

export type S3Provider = "r2" | "s3" | "minio" | "custom";
export type DeletePolicy = "confirm" | "immediate" | "delayed";
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
  deletePolicy: DeletePolicy;
  autoDeleteDelayHours: number;
  s3: S3Config;
  enabledExtensions: string[];
  minSizeRules: Record<string, number>;
  autoCandidateExts: string[];
  customExtensions: string[];
  customReplacements: Record<string, ReplacementType>;
  pendingDeletes: PendingDelete[];
  logs: LogEntry[];
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

export interface Candidate {
  file: TFile;
  ext: string;
  replacement: ReplacementType;
  refs: LocalRef[];
  referenceCount: number;
  sizeBytes: number;
}

export interface PendingDelete {
  createdAt: string;
  dueAt: number;
  notePath: string;
  sourcePath: string;
  remoteUrl: string;
}

export interface LogEntry {
  time: string;
  status: string;
  notePath: string;
  sourcePath: string;
  remoteUrl: string;
  trashed?: boolean;
  dueAt?: string;
}

export interface ProgressState {
  phase: "uploading" | "uploaded" | "rewriting" | "trashing" | "scheduling" | "done";
  current: number;
  total: number;
  label: string;
}

export interface UploadResult {
  key: string;
  publicUrl: string;
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
}

export interface FileCategory {
  id: string;
  nameKey: string;
  replacement: ReplacementType;
  extensions: string[];
}
