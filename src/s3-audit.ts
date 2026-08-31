export const CONTENT_SHA256_METADATA_HEADER = "x-amz-meta-content-sha256";
export const OPERATION_ID_METADATA_HEADER = "x-amz-meta-s3-image-sync-operation-id";

export interface ListS3ObjectsV2Options {
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
}

export interface S3ObjectSummary {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
}

export interface ListS3ObjectsV2Page {
  objects: S3ObjectSummary[];
  nextContinuationToken: string | null;
  isTruncated: boolean;
}

export interface CanonicalizedHeaders {
  canonicalHeaders: string;
  signedHeaders: string;
}

function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** AWS SigV4 URI encoding: RFC 3986 unreserved characters only. */
export function encodeAwsUriComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Encode every S3 key segment while retaining path separators. */
export function encodeS3Key(key: string): string {
  return key.split("/").map(encodeAwsUriComponent).join("/");
}

/** Build the exact, sorted query string used by both the request URL and SigV4. */
export function buildListObjectsV2Query(options: ListS3ObjectsV2Options = {}): string {
  const maxKeys = options.maxKeys ?? 1000;
  if (!Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 1000) {
    throw new Error("ListObjectsV2 maxKeys must be an integer between 1 and 1000");
  }

  const parameters: Array<[string, string]> = [
    ["encoding-type", "url"],
    ["list-type", "2"],
    ["max-keys", String(maxKeys)],
  ];
  if (options.prefix !== undefined) parameters.push(["prefix", options.prefix]);
  if (options.continuationToken) {
    parameters.push(["continuation-token", options.continuationToken]);
  }

  return parameters
    .map(([name, value]): [string, string] => [
      encodeAwsUriComponent(name),
      encodeAwsUriComponent(value),
    ])
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = compareAscii(leftName, rightName);
      return nameOrder !== 0 ? nameOrder : compareAscii(leftValue, rightValue);
    })
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/[\t ]+/g, " ");
}

/** Normalize, sort and serialize headers according to SigV4 canonicalization rules. */
export function canonicalizeSignedHeaders(headers: Record<string, string>): CanonicalizedHeaders {
  const normalized = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim().toLowerCase();
    if (!name) throw new Error("SigV4 header name cannot be empty");
    if (normalized.has(name)) throw new Error(`Duplicate SigV4 header: ${name}`);
    normalized.set(name, normalizeHeaderValue(rawValue));
  }

  const names = Array.from(normalized.keys()).sort(compareAscii);
  return {
    canonicalHeaders: names.map((name) => `${name}:${normalized.get(name) ?? ""}\n`).join(""),
    signedHeaders: names.join(";"),
  };
}

export function getHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string
): string | null {
  const expected = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === expected) return value.trim();
  }
  return null;
}

/**
 * Copy response bytes into an ordinary, independently owned Uint8Array.
 * Electron request buffers can cross an IPC boundary, so callers must not retain or mutate the
 * response's original ArrayBuffer.
 */
export function copyArrayBufferToSafeUint8Array(buffer: ArrayBuffer): Uint8Array {
  const source = new Uint8Array(buffer);
  const safeCopy = new Uint8Array(source.length);
  safeCopy.set(source);
  return safeCopy;
}

export function normalizeContentSha256(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

/**
 * Operation IDs are generated locally for one logical create-only PUT and persisted as object
 * metadata. Keep the accepted alphabet deliberately header-safe so an untrusted remote value can
 * never be reflected into a future signed request.
 */
export function normalizeOperationId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized) ? normalized : null;
}

/**
 * Prefer a valid precomputed hash when it describes the actual upload bytes.
 * A caller may have hashed the source before compression, so a mismatch must fall back to the
 * final-body hash rather than persisting incorrect audit metadata.
 */
export function resolveFinalContentSha256(
  precomputedHash: string | undefined,
  finalBodyHash: string
): string {
  const normalizedFinalHash = normalizeContentSha256(finalBodyHash);
  if (normalizedFinalHash === null) throw new Error("Invalid final-body SHA-256");
  if (precomputedHash === undefined) return normalizedFinalHash;

  const normalizedPrecomputedHash = normalizeContentSha256(precomputedHash);
  if (normalizedPrecomputedHash === null) {
    throw new Error("Invalid precomputed SHA-256: expected 64 hexadecimal characters");
  }
  return normalizedPrecomputedHash === normalizedFinalHash
    ? normalizedPrecomputedHash
    : normalizedFinalHash;
}

export function normalizeLastModified(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString();
}

export function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, token: string) => {
      const lowerToken = token.toLowerCase();
      const namedEntities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (lowerToken in namedEntities) return namedEntities[lowerToken];

      const radix = lowerToken.startsWith("#x") ? 16 : 10;
      const digits = lowerToken.slice(radix === 16 ? 2 : 1);
      const codePoint = Number.parseInt(digits, radix);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return entity;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    }
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlTagPattern(tagName: string, global: boolean): RegExp {
  const escapedName = escapeRegExp(tagName);
  const namespace = "(?:[A-Za-z_][\\w.-]*:)?";
  return new RegExp(
    `<${namespace}${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${namespace}${escapedName}\\s*>`,
    global ? "gi" : "i"
  );
}

function extractXmlText(xml: string, tagName: string): string | null {
  const match = xmlTagPattern(tagName, false).exec(xml);
  if (!match) return null;
  const rawValue = match[1].trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(rawValue);
  return decodeXmlEntities(cdataMatch ? cdataMatch[1] : rawValue);
}

function extractXmlElements(xml: string, tagName: string): string[] {
  const pattern = xmlTagPattern(tagName, true);
  const elements: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) elements.push(match[1]);
  return elements;
}

function parseObjectSize(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) {
    throw new Error("Invalid ListObjectsV2 response: object size is missing or invalid");
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size)) {
    throw new Error("Invalid ListObjectsV2 response: object size exceeds the safe integer range");
  }
  return size;
}

function decodeListedKey(value: string, isUrlEncoded: boolean): string {
  if (!isUrlEncoded) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse an S3-compatible ListObjectsV2 XML response without relying on DOM globals. */
export function parseListObjectsV2Xml(xml: string): ListS3ObjectsV2Page {
  const roots = extractXmlElements(xml, "ListBucketResult");
  if (roots.length !== 1) {
    throw new Error("Invalid ListObjectsV2 response: ListBucketResult is missing or ambiguous");
  }
  const root = roots[0];
  const encodingType = extractXmlText(root, "EncodingType");
  const isUrlEncoded = encodingType?.toLowerCase() === "url";
  const objects = extractXmlElements(root, "Contents").map((contents): S3ObjectSummary => {
    const encodedKey = extractXmlText(contents, "Key");
    if (encodedKey === null) {
      throw new Error("Invalid ListObjectsV2 response: object key is missing");
    }
    return {
      key: decodeListedKey(encodedKey, isUrlEncoded),
      size: parseObjectSize(extractXmlText(contents, "Size")),
      etag: extractXmlText(contents, "ETag"),
      lastModified: normalizeLastModified(extractXmlText(contents, "LastModified")),
    };
  });

  return {
    objects,
    nextContinuationToken: extractXmlText(root, "NextContinuationToken"),
    isTruncated: extractXmlText(root, "IsTruncated")?.toLowerCase() === "true",
  };
}
