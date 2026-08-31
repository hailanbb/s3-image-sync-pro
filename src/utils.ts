import type {
  LocalRef,
  RecognizedCloudDomainRecord,
  ReplacementType,
  S3Config,
} from "./types";

export function basename(path: string): string {
  return String(path || "").split("/").pop() || path;
}

export function trimSlashes(path: string): string {
  return String(path || "").replace(/^\/+|\/+$/g, "");
}

export function buildStorageIdentity(
  s3: S3Config,
  configuredMirrorRoot: string
): string {
  const rawEndpoint = String(s3.endpoint || "").trim().replace(/\/+$/, "");
  let endpoint = rawEndpoint;
  try {
    const parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawEndpoint)
      ? rawEndpoint
      : `https://${rawEndpoint}`);
    endpoint = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    // Preserve a literal endpoint because its path may be case-sensitive.
  }
  const mirrorRoot = trimSlashes(configuredMirrorRoot || "98 cloudflareR2");
  let accessKeyFingerprint = 2166136261;
  for (const char of String(s3.accessKeyId || "")) {
    accessKeyFingerprint ^= char.charCodeAt(0);
    accessKeyFingerprint = Math.imul(accessKeyFingerprint, 16777619);
  }
  return [
    s3.provider,
    endpoint,
    s3.bucketName,
    mirrorRoot,
    (accessKeyFingerprint >>> 0).toString(16),
  ].join("|");
}

export function normalizeCloudUrlPrefix(value: string): string {
  let raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/**
 * Upgrade legacy string prefixes by binding them to the storage selected when
 * the settings file is loaded. Existing structured records keep their owner.
 */
export function normalizeRecognizedCloudDomains(
  values: readonly unknown[],
  legacyStorageIdentity: string
): RecognizedCloudDomainRecord[] {
  const records = new Map<string, RecognizedCloudDomainRecord>();
  for (const value of values) {
    const rawPrefix = typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as { prefix?: unknown }).prefix === "string"
        ? (value as { prefix: string }).prefix
        : "";
    const rawIdentity = typeof value === "string"
      ? legacyStorageIdentity
      : value && typeof value === "object" &&
          typeof (value as { storageIdentity?: unknown }).storageIdentity === "string"
        ? (value as { storageIdentity: string }).storageIdentity
        : "";
    const prefix = normalizeCloudUrlPrefix(rawPrefix);
    const storageIdentity = rawIdentity.trim();
    if (!prefix || !storageIdentity) continue;
    records.set(`${storageIdentity}\u0000${prefix}`, { prefix, storageIdentity });
  }
  return [...records.values()].slice(-100);
}

export function cloudUrlPrefixesForStorage(
  currentPrefix: string,
  records: readonly RecognizedCloudDomainRecord[],
  storageIdentity: string
): string[] {
  const prefixes = [
    currentPrefix,
    ...records
      .filter((record) => record.storageIdentity === storageIdentity)
      .map((record) => record.prefix),
  ]
    .map(normalizeCloudUrlPrefix)
    .filter(Boolean);
  return [...new Set(prefixes)].sort((a, b) => b.length - a.length);
}

export function cloudKeyFromRecognizedUrl(
  url: string,
  prefixes: readonly string[]
): string | null {
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return null;
  }
  const normalizedPrefixes = [...new Set(prefixes
    .map(normalizeCloudUrlPrefix)
    .filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const prefix of normalizedPrefixes) {
    try {
      const base = new URL(prefix);
      if (candidate.host.toLowerCase() !== base.host.toLowerCase()) continue;
      const basePath = base.pathname.replace(/\/+$/, "");
      const keyStart = basePath ? `${basePath}/` : "/";
      if (!candidate.pathname.startsWith(keyStart)) continue;
      const encodedKey = candidate.pathname.slice(keyStart.length);
      if (!encodedKey) continue;
      try {
        return trimSlashes(decodeURIComponent(encodedKey)) || null;
      } catch {
        return trimSlashes(encodedKey) || null;
      }
    } catch {
      // Ignore malformed historical prefixes.
    }
  }
  return null;
}

export function cloudKeyFromLocalMirrorPath(filePath: string, mirrorRoot: string): string | null {
  const normalizedPath = trimSlashes(String(filePath || "").replace(/\\/g, "/"));
  const normalizedRoot = trimSlashes(String(mirrorRoot || "").replace(/\\/g, "/"));
  if (!normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) return null;
  return trimSlashes(normalizedPath.slice(normalizedRoot.length + 1)) || null;
}

export function safeFilename(name: string): string {
  return String(name || "attachment").replace(/[\\/:*?"<>|#%]+/g, "-");
}

export function usesCanonicalNotePathTemplate(template: string): boolean {
  const normalized = trimSlashes(template).replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments.length === 3 &&
    segments[0] === "{notedir}" &&
    segments[1] === "{notename}" &&
    segments[2].includes("{filename}") &&
    segments[2].includes("{ext}");
}

export function buildCanonicalNoteKey(
  cloudKey: string,
  noteDir: string,
  noteName: string
): string | null {
  const segments = trimSlashes(cloudKey).split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const safeDir = noteDir.replace(/[\\:*?"<>|]+/g, "-");
  const safeName = noteName.replace(/[\\/:*?"<>|#%]+/g, "-");
  const filename = segments[segments.length - 1];
  return [safeDir, safeName, filename].filter(Boolean).join("/");
}

export function isKeyReferencedElsewhere(
  noteRemoteUrls: ReadonlyMap<string, readonly string[]>,
  key: string,
  excludedNotePath: string
): boolean {
  for (const [notePath, keys] of noteRemoteUrls) {
    if (notePath !== excludedNotePath && keys.includes(key)) return true;
  }
  return false;
}

export function renderPathTemplate(
  template: string,
  values: { ext: string; hash: string; hash2: string; filename: string; notedir?: string; notename?: string }
): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hashShort = (values.hash || "").slice(0, 32);

  return String(template || "{notedir}/{notename}/{filename}-{hash-short}.{ext}")
    .replace(/\\/g, "/")
    .replace(/\{ext\}/g, values.ext)
    .replace(/\{hash\}/g, values.hash)
    .replace(/\{hash2\}/g, values.hash2)
    .replace(/\{filename\}/g, values.filename)
    .replace(/\{notedir\}/g, values.notedir ? values.notedir.replace(/[\\:*?"<>|]+/g, "-") : "")
    .replace(/\{notename\}/g, values.notename ? values.notename.replace(/[\\/:*?"<>|#%]+/g, "-") : "")
    .replace(/\{hash-short\}/g, hashShort)
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{MM\}/g, MM)
    .replace(/\{dd\}/g, dd)
    .replace(/^\/+/, "");
}

export function buildPublicUrl(domain: string, endpoint: string, bucket: string, key: string): string {
  let base = String(domain || "").replace(/\/+$/, "");
  if (!base) {
    let cleanEndpoint = String(endpoint || "").replace(/\/+$/, "");
    if (cleanEndpoint && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleanEndpoint)) {
       cleanEndpoint = `https://${cleanEndpoint}`;
    }
    base = `${cleanEndpoint}/${bucket}`;
  } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base)) {
    base = `https://${base}`;
  }
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function replaceAllLiteral(text: string, search: string, replacement: string): string {
  return text.split(search).join(replacement);
}

export function escapeMarkdownLabel(label: string): string {
  return String(label || "attachment").replace(/\]/g, "\\]");
}

export function buildLinkReplacement(
  ref: LocalRef,
  replacement: ReplacementType,
  targetUrl: string
): string {
  const url = ref.fragment
    ? `${targetUrl}#${encodeURIComponent(ref.fragment)}`
    : targetUrl;
  const label = escapeMarkdownLabel(ref.label || basename(ref.target));

  if (replacement === "image") return `![${label}](${url})`;
  if (replacement === "video") return `<video src="${url}" controls></video>`;
  if (replacement === "audio") return `<audio src="${url}" controls></audio>`;
  return `[${label}](${url})`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function contentTypeForExt(ext: string): string {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    epub: "application/epub+zip",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    heic: "image/heic",
    bmp: "image/bmp",
    tiff: "image/tiff",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    aac: "audio/aac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    webm: "video/webm",
    flv: "video/x-flv",
  };
  return map[ext] || "application/octet-stream";
}

export function isPreviewableImage(ext: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(
    String(ext || "").toLowerCase()
  );
}

export function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: number;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
