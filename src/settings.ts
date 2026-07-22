import { PluginSettings, S3Config, ReplacementType, PendingDelete, LogEntry } from "./types";
import { FILE_CATEGORIES } from "./file-categories";

const DEFAULT_S3: S3Config = {
  provider: "r2",
  endpoint: "",
  region: "auto",
  bucketName: "",
  accessKeyId: "",
  secretAccessKey: "",
  customDomainName: "",
  pathTemplate: "attachments/{ext}/{hash2}/{hash}.{ext}",
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
  attachmentRoot: "90-笔记系统/92-附件",
  deletePolicy: "confirm",
  autoDeleteDelayHours: 24,
  s3: DEFAULT_S3,
  enabledExtensions: DEFAULT_ENABLED_EXTS,
  minSizeRules: DEFAULT_MIN_SIZE,
  autoCandidateExts: DEFAULT_AUTO_CANDIDATE_EXTS,
  customExtensions: [],
  customReplacements: {},
  pendingDeletes: [],
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
  pendingDeletes?: PendingDelete[];
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
  pendingDeletes?: PendingDelete[];
  logs?: LogEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const data: LoadedSettings = isObject(loaded) ? loaded as LoadedSettings : {};
  const migrated = migrateOldSettings(data);

  const s3Data = data.s3 || migrated.s3 || data.r2 || {};
  const s3: S3Config = {
    ...defaults.s3,
    ...s3Data,
    provider: s3Data.provider || (data.r2 ? "r2" : "r2"),
    region: s3Data.region || (s3Data.provider === "r2" || data.r2 ? "auto" : "us-east-1"),
  };

  return {
    ...defaults,
    s3,
    enabledExtensions: migrated.enabledExtensions || data.enabledExtensions || defaults.enabledExtensions,
    minSizeRules: migrated.minSizeRules || data.minSizeRules || defaults.minSizeRules,
    autoCandidateExts: migrated.autoCandidateExts || data.autoCandidateExts || defaults.autoCandidateExts,
    customExtensions: data.customExtensions || defaults.customExtensions,
    customReplacements: migrated.customReplacements || data.customReplacements || defaults.customReplacements,
    pendingDeletes: Array.isArray(data.pendingDeletes) ? data.pendingDeletes : [],
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
