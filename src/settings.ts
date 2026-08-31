import {
  PluginSettings,
  S3Config,
  ReplacementType,
  LogEntry,
  NoteSyncSnapshot,
  PendingDeleteRecord,
  PendingDeleteOperation,
  ObjectVersionRecord,
  OwnedObjectRecord,
  RecognizedCloudDomainRecord,
} from "./types";
import type { PathPolicyRule, ProcessingScopeMode } from "./path-policy";
import { FILE_CATEGORIES } from "./file-categories";
import { buildStorageIdentity, normalizeRecognizedCloudDomains } from "./utils";

const DEFAULT_S3: S3Config = {
  provider: "r2",
  endpoint: "",
  region: "auto",
  bucketName: "",
  accessKeyId: "",
  secretAccessKey: "",
  customDomainName: "",
  pathTemplate: "{notedir}/{notename}/{filename}-{hash-short}.{ext}",
};

const DEFAULT_ENABLED_EXTS: string[] = [
  "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "tiff"
];

const DEFAULT_MIN_SIZE: Record<string, number> = {
  png: 0, jpg: 0, jpeg: 0, gif: 0, webp: 0, svg: 0, heic: 0, bmp: 0, tiff: 0,
};

const DEFAULT_AUTO_CANDIDATE_EXTS: string[] = [
  "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "tiff"
];

export const DEFAULT_SETTINGS: PluginSettings = {
  enabled: true,
  autoScanEnabled: false,
  scanIntervalMinutes: 30,
  quietSeconds: 600,
  autoScanMinSizeMiB: 0,
  attachmentRoot: "",
  s3: DEFAULT_S3,
  enabledExtensions: DEFAULT_ENABLED_EXTS,
  minSizeRules: DEFAULT_MIN_SIZE,
  autoCandidateExts: DEFAULT_AUTO_CANDIDATE_EXTS,
  customExtensions: [],
  customReplacements: {},
  webpEnabled: false,
  webpQuality: 80,
  webpSkipFormats: ["svg", "gif"],
  deleteRemoteOnNoteDelete: false,
  autoUploadOnPaste: false,
  autoTransferRemoteImages: false,
  trashOriginalAfterUpload: false,
  remoteImageMaxSizeMiB: 10,
  syncS3OnNoteMove: true,
  deleteOldObjectAfterPathMigration: false,
  localMirrorRoot: "98 cloudflareR2",
  recognizedCloudDomains: [],
  processingScopeMode: "legacy",
  pathPolicies: [],
  excludedNotePaths: [],
  excludedPathSyncKeyPrefixes: ["mpclipper"],
  startupCatchupEnabled: true,
  startupCatchupPendingPaths: [],
  deleteGraceMinutes: 10,
  pruneEmptyMirrorFolders: true,
  noteSyncIndex: {},
  pendingDeleteQueue: [],
  ownedObjectKeys: [],
  linkMode: "local",
  logs: [],
};

interface OldRule {
  extensions: string;
  minSizeMiB: number;
  autoCandidate: boolean;
  replacement: string;
}

interface OldLoadedSettings {
  r2?: Partial<S3Config>;
  rules?: OldRule[];
  s3?: Partial<S3Config>;
  provider?: string;
  region?: string;
  enabledExtensions?: string[];
  minSizeRules?: Record<string, number>;
  autoCandidateExts?: string[];
  customExtensions?: string[];
  customReplacements?: Record<string, ReplacementType>;
  logs?: LogEntry[];
}

interface LoadedSettings {
  r2?: Partial<S3Config>;
  s3?: Partial<S3Config>;
  provider?: string;
  region?: string;
  enabledExtensions?: string[];
  minSizeRules?: Record<string, number>;
  autoCandidateExts?: string[];
  customExtensions?: string[];
  customReplacements?: Record<string, ReplacementType>;
  excludedNotePaths?: string[];
  excludedPathSyncKeyPrefixes?: string[];
  localMirrorRoot?: string;
  recognizedCloudDomains?: Array<string | RecognizedCloudDomainRecord>;
  deleteRemoteOnNoteDelete?: boolean;
  deleteOldObjectAfterPathMigration?: boolean;
  processingScopeMode?: ProcessingScopeMode;
  pathPolicies?: PathPolicyRule[];
  startupCatchupPendingPaths?: string[];
  noteSyncIndex?: Record<string, NoteSyncSnapshot>;
  pendingDeleteQueue?: PendingDeleteRecord[];
  ownedObjectKeys?: Array<string | OwnedObjectRecord>;
  logs?: LogEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObjectVersion(value: unknown): ObjectVersionRecord | null {
  if (!isObject(value)) return null;
  return typeof value.contentSha256 === "string" && typeof value.size === "number" &&
    typeof value.operationId === "string" && typeof value.etag === "string"
    ? {
        contentSha256: value.contentSha256,
        size: value.size,
        operationId: value.operationId,
        etag: value.etag,
      }
    : null;
}

function readExpectedVersions(value: unknown): Record<string, ObjectVersionRecord> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, version]) => {
    const parsed = readObjectVersion(version);
    return parsed ? [[key, parsed]] : [];
  }));
}

function readPendingDeleteOperation(value: unknown): PendingDeleteOperation | undefined {
  const version = readObjectVersion(value);
  if (!version || !isObject(value) || typeof value.key !== "string" || typeof value.startedAt !== "number") {
    return undefined;
  }
  return { key: value.key, startedAt: value.startedAt, ...version };
}

function migrateOldSettings(loaded: OldLoadedSettings): Partial<PluginSettings> {
  const result: Partial<PluginSettings> = {};

  if (loaded.r2) {
    result.s3 = {
      ...DEFAULT_S3,
      ...loaded.r2,
      provider: "r2",
      region: "auto",
    };
  }

  if (Array.isArray(loaded.rules) && loaded.rules.length > 0) {
    const enabledExtensions: string[] = [];
    const minSizeRules: Record<string, number> = {};
    const autoCandidateExts: string[] = [];
    const customReplacements: Record<string, ReplacementType> = {};

    for (const rule of loaded.rules) {
      const exts = rule.extensions
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      for (const ext of exts) {
        enabledExtensions.push(ext);
        minSizeRules[ext] = rule.minSizeMiB;
        if (rule.autoCandidate) autoCandidateExts.push(ext);
        if (rule.replacement !== FILE_CATEGORIES.find((c) => c.extensions.includes(ext))?.replacement) {
          customReplacements[ext] = rule.replacement as ReplacementType;
        }
      }
    }

    result.enabledExtensions = enabledExtensions;
    result.minSizeRules = minSizeRules;
    result.autoCandidateExts = autoCandidateExts;
    result.customReplacements = customReplacements;
  }

  return result;
}

export function mergeSettings(defaults: PluginSettings, loaded: unknown): PluginSettings {
  const data: LoadedSettings = isObject(loaded) ? loaded : {};
  const migrated = migrateOldSettings(data);

  const s3Data = data.s3 || migrated.s3 || data.r2 || {};
  const s3: S3Config = {
    ...defaults.s3,
    ...s3Data,
    provider: s3Data.provider || (data.r2 ? "r2" : "r2"),
    region: s3Data.region || (s3Data.provider === "r2" || data.r2 ? "auto" : "us-east-1"),
  };
  const configuredMirrorRoot = typeof data.localMirrorRoot === "string"
    ? data.localMirrorRoot
    : defaults.localMirrorRoot;
  const currentStorageIdentity = buildStorageIdentity(s3, configuredMirrorRoot);

  return {
    ...defaults,
    ...data,
    s3,
    deleteRemoteOnNoteDelete: s3.provider === "s3" && data.deleteRemoteOnNoteDelete === true,
    deleteOldObjectAfterPathMigration:
      s3.provider === "s3" && data.deleteOldObjectAfterPathMigration === true,
    enabledExtensions: migrated.enabledExtensions || data.enabledExtensions || defaults.enabledExtensions,
    minSizeRules: migrated.minSizeRules || data.minSizeRules || defaults.minSizeRules,
    autoCandidateExts: migrated.autoCandidateExts || data.autoCandidateExts || defaults.autoCandidateExts,
    customExtensions: data.customExtensions || defaults.customExtensions,
    customReplacements: migrated.customReplacements || data.customReplacements || defaults.customReplacements,
    excludedNotePaths: Array.isArray(data.excludedNotePaths)
      ? data.excludedNotePaths.filter((path): path is string => typeof path === "string")
      : defaults.excludedNotePaths,
    processingScopeMode: data.processingScopeMode === "policy" ? "policy" : "legacy",
    pathPolicies: Array.isArray(data.pathPolicies)
      ? data.pathPolicies.filter((rule): rule is PathPolicyRule =>
          isObject(rule) &&
          typeof rule.path === "string" &&
          ["ignore", "staging", "managed", "verify"].includes(String(rule.mode))
        ).map((rule) => ({ path: rule.path, mode: rule.mode }))
      : defaults.pathPolicies,
    excludedPathSyncKeyPrefixes: Array.isArray(data.excludedPathSyncKeyPrefixes)
      ? data.excludedPathSyncKeyPrefixes.filter((prefix): prefix is string => typeof prefix === "string")
      : defaults.excludedPathSyncKeyPrefixes,
    startupCatchupPendingPaths: Array.isArray(data.startupCatchupPendingPaths)
      ? [...new Set(data.startupCatchupPendingPaths
          .filter((path): path is string => typeof path === "string")
          .map((path) => path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
          .filter(Boolean))].slice(-20000)
      : defaults.startupCatchupPendingPaths,
    recognizedCloudDomains: normalizeRecognizedCloudDomains(
      Array.isArray(data.recognizedCloudDomains)
        ? data.recognizedCloudDomains
        : defaults.recognizedCloudDomains,
      currentStorageIdentity
    ),
    noteSyncIndex: isObject(data.noteSyncIndex)
      ? Object.fromEntries(Object.entries(data.noteSyncIndex).filter((entry): entry is [string, NoteSyncSnapshot] => {
          const value = entry[1];
          return isObject(value) && typeof value.mtime === "number" && typeof value.size === "number" &&
            Array.isArray(value.keys) && value.keys.every((key) => typeof key === "string");
        }))
      : {},
    pendingDeleteQueue: Array.isArray(data.pendingDeleteQueue)
      ? data.pendingDeleteQueue.filter((record): record is PendingDeleteRecord =>
          isObject(record) && typeof record.id === "string" && typeof record.notePath === "string" &&
          Array.isArray(record.keys) && record.keys.every((key) => typeof key === "string") &&
          typeof record.dueAt === "number" && typeof record.attempts === "number" &&
          ["note-delete", "startup-missing", "path-migration"].includes(String(record.reason))
        ).map((record) => ({
          ...record,
          expectedVersions: readExpectedVersions(record.expectedVersions),
          inFlight: readPendingDeleteOperation(record.inFlight),
        }))
      : [],
    ownedObjectKeys: Array.isArray(data.ownedObjectKeys)
      ? data.ownedObjectKeys.flatMap((value): OwnedObjectRecord[] => {
          if (typeof value === "string") return [{ key: value, storageIdentity: "legacy-unbound" }];
          if (isObject(value) && typeof value.key === "string" && typeof value.storageIdentity === "string") {
            return [{
              key: value.key,
              storageIdentity: value.storageIdentity,
              contentSha256: typeof value.contentSha256 === "string" ? value.contentSha256 : undefined,
              size: typeof value.size === "number" ? value.size : undefined,
              operationId: typeof value.operationId === "string" ? value.operationId : undefined,
              etag: typeof value.etag === "string" ? value.etag : undefined,
            }];
          }
          return [];
        }).slice(-20000)
      : [],
    logs: Array.isArray(data.logs) ? data.logs.slice(0, 100) : [],
  };
}

export function getReplacementForExt(
  ext: string,
  settings: PluginSettings
): ReplacementType {
  if (settings.customReplacements[ext]) return settings.customReplacements[ext];
  const allExts = [...FILE_CATEGORIES.flatMap((c) => c.extensions), ...settings.customExtensions];
  if (!allExts.includes(ext) && !settings.enabledExtensions.includes(ext)) return "markdown";
  const category = FILE_CATEGORIES.find((c) => c.extensions.includes(ext));
  return category?.replacement || "markdown";
}
