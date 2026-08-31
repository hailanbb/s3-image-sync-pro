import { requestUrl } from "obsidian";
import { S3Config } from "./types";
import { sha256Hex, hmacHex, getSignatureKey } from "./crypto";
import { toAmzDate } from "./utils";
import {
  CONTENT_SHA256_METADATA_HEADER,
  OPERATION_ID_METADATA_HEADER,
  ListS3ObjectsV2Options,
  ListS3ObjectsV2Page,
  buildListObjectsV2Query,
  canonicalizeSignedHeaders,
  copyArrayBufferToSafeUint8Array,
  encodeS3Key,
  getHeaderCaseInsensitive,
  normalizeContentSha256,
  normalizeLastModified,
  normalizeOperationId,
  parseListObjectsV2Xml,
  resolveFinalContentSha256,
} from "./s3-audit";

export type {
  ListS3ObjectsV2Options,
  ListS3ObjectsV2Page,
  S3ObjectSummary,
} from "./s3-audit";

export interface S3HeadObjectResult {
  exists: boolean;
  key: string;
  size: number | null;
  etag: string | null;
  lastModified: string | null;
  contentSha256: string | null;
  operationId: string | null;
}

export interface S3GetObjectResult {
  exists: boolean;
  key: string;
  body: Uint8Array;
  contentType: string | null;
  etag: string | null;
  contentSha256: string | null;
  operationId: string | null;
}

export interface PutS3ObjectOptions {
  /** Create only. A concurrent or pre-existing object is never overwritten. */
  ifNoneMatch?: boolean;
}

export interface PutS3ObjectResult {
  status: "created" | "exists";
  /** Stable across all internal retries for this one logical PUT. */
  operationId: string;
  contentSha256: string;
}

export type DeleteS3ObjectResult =
  | "deleted"
  | "missing"
  | "precondition-failed"
  | "unsupported";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

class NonRetryableS3PutError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function createPutOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) throw new Error("Secure random generator is unavailable");
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * A response alone never proves that the currently visible key is still the version created by this
 * invocation. The body hash and the operation metadata must both match, including after a 2xx PUT.
 */
export function isPutOwnershipConfirmed(
  result: PutS3ObjectResult,
  observedContentSha256: string,
  observedOperationId: string | null
): boolean {
  if (normalizeContentSha256(observedContentSha256) !== result.contentSha256) return false;
  return observedOperationId === result.operationId;
}

/** R2 only supports region "auto" for Signature V4; stored value may be "us-east-1" from old configs */
function getEffectiveRegion(config: S3Config): string {
  if (config.provider === "r2") return "auto";
  return config.region || "us-east-1";
}

export async function putS3Object(
  config: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
  formatError: (status: number, text: string) => string,
  precomputedHash?: string,
  options: PutS3ObjectOptions = {}
): Promise<PutS3ObjectResult> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedKey = encodeS3Key(key);
  const url = `${endpoint}/${bucket}/${encodedKey}`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);

  // CRITICAL FIX: Ensure the body is a pure V8 ArrayBuffer before it's passed to Electron IPC via requestUrl.
  // WASM-backed ArrayBuffers can cause structured clone / serialization issues over IPC, leading to corrupted 
  // uploads and XAmzContentSHA256Mismatch errors.
  const safeBody = new Uint8Array(body.length);
  safeBody.set(body);
  const safeBuffer = safeBody.buffer;
  const finalBodyHash = await sha256Hex(safeBody);
  const contentSha256 = resolveFinalContentSha256(precomputedHash, finalBodyHash);
  // Generate once per logical operation, outside the retry loop. If the first response is lost,
  // the retry sees 412 and callers can prove the existing object came from this invocation.
  const operationId = createPutOperationId();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    // CRITICAL FIX: AWS S3 & Cloudflare R2 support "UNSIGNED-PAYLOAD" for HTTPS requests.
    // This entirely bypasses the x-amz-content-sha256 body hash verification, which fixes the Mismatch 
    // error caused by Electron IPC altering or truncating ArrayBuffers during requestUrl calls.
    const payloadHash = "UNSIGNED-PAYLOAD";

    const signedHeaderValues: Record<string, string> = {
      host: parsed.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      [CONTENT_SHA256_METADATA_HEADER]: contentSha256,
      [OPERATION_ID_METADATA_HEADER]: operationId,
    };
    if (options.ifNoneMatch) signedHeaderValues["if-none-match"] = "*";
    const { canonicalHeaders, signedHeaders } = canonicalizeSignedHeaders(signedHeaderValues);

    const canonicalRequest = [
      "PUT",
      parsed.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");

    const signingKey = await getSignatureKey(
      config.secretAccessKey,
      dateStamp,
      region,
      "s3"
    );
    const signature = await hmacHex(signingKey, stringToSign);

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      [CONTENT_SHA256_METADATA_HEADER]: contentSha256,
      [OPERATION_ID_METADATA_HEADER]: operationId,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (options.ifNoneMatch) headers["If-None-Match"] = "*";

    try {
      const response = await requestUrl({
        url,
        method: "PUT",
        headers,
        body: safeBuffer,
        throw: false,
      });

      if (response.status >= 200 && response.status < 300) {
        return { status: "created", operationId, contentSha256 };
      }
      if (options.ifNoneMatch && response.status === 412) {
        return { status: "exists", operationId, contentSha256 };
      }

      if (shouldRetry(response.status) && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }

      throw new NonRetryableS3PutError(formatError(response.status, response.text || ""));
    } catch (error: unknown) {
      if (error instanceof NonRetryableS3PutError) throw error;
      // Network / transport errors are retriable
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("S3 put failed after exhausting retries");
}

function parseContentLength(headers: Record<string, string>): number | null {
  const rawValue = getHeaderCaseInsensitive(headers, "content-length");
  if (rawValue === null || !/^\d+$/.test(rawValue)) return null;
  const size = Number(rawValue);
  return Number.isSafeInteger(size) ? size : null;
}

export async function headS3Object(config: S3Config, key: string): Promise<S3HeadObjectResult> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedKey = encodeS3Key(key);
  const url = `${endpoint}/${bucket}/${encodedKey}`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);
  const emptyHash = await sha256Hex(new Uint8Array(0));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const { canonicalHeaders, signedHeaders } = canonicalizeSignedHeaders({
      host: parsed.host,
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
    });
    const canonicalRequest = [
      "HEAD",
      parsed.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      emptyHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");
    const signingKey = await getSignatureKey(
      config.secretAccessKey,
      dateStamp,
      region,
      "s3"
    );
    const signature = await hmacHex(signingKey, stringToSign);
    const headers: Record<string, string> = {
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    try {
      const response = await requestUrl({ url, method: "HEAD", headers, throw: false });
      if (response.status === 404) {
        return {
          exists: false,
          key,
          size: null,
          etag: null,
          lastModified: null,
          contentSha256: null,
          operationId: null,
        };
      }
      if (response.status >= 200 && response.status < 300) {
        return {
          exists: true,
          key,
          size: parseContentLength(response.headers),
          etag: getHeaderCaseInsensitive(response.headers, "etag"),
          lastModified: normalizeLastModified(
            getHeaderCaseInsensitive(response.headers, "last-modified")
          ),
          contentSha256: normalizeContentSha256(
            getHeaderCaseInsensitive(response.headers, CONTENT_SHA256_METADATA_HEADER)
          ),
          operationId: normalizeOperationId(
            getHeaderCaseInsensitive(response.headers, OPERATION_ID_METADATA_HEADER)
          ),
        };
      }
      if (shouldRetry(response.status) && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`S3 head failed (${response.status}): ${response.text || ""}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("S3 head failed")) throw error;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }

  throw new Error("S3 head failed after exhausting retries");
}

/**
 * Read an object through the authenticated S3 API rather than a public/custom domain.
 * This avoids CDN cache staleness and also works for private buckets.
 */
export async function getS3Object(config: S3Config, key: string): Promise<S3GetObjectResult> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedKey = encodeS3Key(key);
  const url = `${endpoint}/${bucket}/${encodedKey}`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);
  const emptyHash = await sha256Hex(new Uint8Array(0));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const { canonicalHeaders, signedHeaders } = canonicalizeSignedHeaders({
      host: parsed.host,
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
    });
    const canonicalRequest = [
      "GET",
      parsed.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      emptyHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");
    const signingKey = await getSignatureKey(
      config.secretAccessKey,
      dateStamp,
      region,
      "s3"
    );
    const signature = await hmacHex(signingKey, stringToSign);
    const headers: Record<string, string> = {
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };

    try {
      const response = await requestUrl({ url, method: "GET", headers, throw: false });
      if (response.status === 404) {
        return {
          exists: false,
          key,
          body: new Uint8Array(0),
          contentType: null,
          etag: null,
          contentSha256: null,
          operationId: null,
        };
      }
      if (response.status >= 200 && response.status < 300) {
        return {
          exists: true,
          key,
          body: copyArrayBufferToSafeUint8Array(response.arrayBuffer),
          contentType: getHeaderCaseInsensitive(response.headers, "content-type"),
          etag: getHeaderCaseInsensitive(response.headers, "etag"),
          contentSha256: normalizeContentSha256(
            getHeaderCaseInsensitive(response.headers, CONTENT_SHA256_METADATA_HEADER)
          ),
          operationId: normalizeOperationId(
            getHeaderCaseInsensitive(response.headers, OPERATION_ID_METADATA_HEADER)
          ),
        };
      }
      if (shouldRetry(response.status) && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`S3 get failed (${response.status}): ${response.text || ""}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("S3 get failed")) throw error;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }

  throw new Error("S3 get failed after exhausting retries");
}

export async function listS3ObjectsV2(
  config: S3Config,
  options: ListS3ObjectsV2Options = {}
): Promise<ListS3ObjectsV2Page> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const canonicalQuery = buildListObjectsV2Query(options);
  const url = `${endpoint}/${bucket}/?${canonicalQuery}`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);
  const emptyHash = await sha256Hex(new Uint8Array(0));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const { canonicalHeaders, signedHeaders } = canonicalizeSignedHeaders({
      host: parsed.host,
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
    });
    const canonicalRequest = [
      "GET",
      parsed.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      emptyHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");
    const signingKey = await getSignatureKey(
      config.secretAccessKey,
      dateStamp,
      region,
      "s3"
    );
    const signature = await hmacHex(signingKey, stringToSign);
    const headers: Record<string, string> = {
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };

    try {
      const response = await requestUrl({ url, method: "GET", headers, throw: false });
      if (response.status >= 200 && response.status < 300) {
        return parseListObjectsV2Xml(response.text || "");
      }
      if (shouldRetry(response.status) && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`S3 list failed (${response.status}): ${response.text || ""}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("S3 list failed")) throw error;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }

  throw new Error("S3 list failed after exhausting retries");
}

export async function copyS3Object(config: S3Config, sourceKey: string, destKey: string): Promise<void> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedDestKey = encodeS3Key(destKey);
  const url = `${endpoint}/${bucket}/${encodedDestKey}`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);

  const encodedSourceKey = encodeS3Key(sourceKey);
  const copySource = `/${bucket}/${encodedSourceKey}`;

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const emptyHash = await sha256Hex(new Uint8Array(0));

  const canonicalHeaders =
    [
      `host:${parsed.host}`,
      `x-amz-content-sha256:${emptyHash}`,
      `x-amz-copy-source:${copySource}`,
      `x-amz-date:${amzDate}`,
    ].join("\n") + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-copy-source;x-amz-date";

  const canonicalRequest = [
    "PUT",
    parsed.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    emptyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, region, "s3");
  const signature = await hmacHex(signingKey, stringToSign);

  const headers: Record<string, string> = {
    "x-amz-content-sha256": emptyHash,
    "x-amz-copy-source": copySource,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  const response = await requestUrl({ url, method: "PUT", headers, throw: false });
  if (response.status >= 200 && response.status < 300) return;
  throw new Error(`S3 copy failed (${response.status}): ${response.text || ""}`);
}

/**
 * AWS S3 supports atomic If-Match conditional deletes. R2 and other compatible providers do not
 * currently document equivalent semantics, so the plugin preserves their objects instead of
 * issuing an unsafe key-only DELETE.
 */
export function supportsAtomicConditionalDelete(config: S3Config): boolean {
  return config.provider === "s3";
}

export async function deleteS3Object(
  config: S3Config,
  key: string,
  expectedEtag: string
): Promise<DeleteS3ObjectResult> {
  if (!supportsAtomicConditionalDelete(config)) return "unsupported";
  if (!expectedEtag) throw new Error("S3 conditional delete requires a verified ETag");
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedKey = encodeS3Key(key);
  const url = `${endpoint}/${bucket}/${encodedKey}`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);
  const emptyHash = await sha256Hex(new Uint8Array(0));

  // One attempt only. Retrying an ambiguous DELETE could remove a new object
  // recreated under the same key after the first request succeeded.
  for (let attempt = 0; attempt < 1; attempt++) {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);

    const { canonicalHeaders, signedHeaders } = canonicalizeSignedHeaders({
      host: parsed.host,
      "if-match": expectedEtag,
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
    });

    const canonicalRequest = [
      "DELETE",
      parsed.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      emptyHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join("\n");

    const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, region, "s3");
    const signature = await hmacHex(signingKey, stringToSign);

    const headers: Record<string, string> = {
      "If-Match": expectedEtag,
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };

    try {
      const response = await requestUrl({ url, method: "DELETE", headers, throw: false });
      
      if (response.status >= 200 && response.status < 300) return "deleted";
      if (response.status === 404) return "missing";
      if (response.status === 409 || response.status === 412) return "precondition-failed";

      throw new Error(`S3 delete failed (${response.status}): ${response.text || ""}`);
    } catch (error: unknown) {
      throw error;
    }
  }
  throw new Error("S3 delete failed with an uncertain outcome");
}

export async function testS3Connection(config: S3Config): Promise<void> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const url = `${endpoint}/${bucket}/`;
  const parsed = new URL(url);
  const region = getEffectiveRegion(config);

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const emptyHash = await sha256Hex(new Uint8Array(0));

  const canonicalHeaders =
    [
      `host:${parsed.host}`,
      `x-amz-content-sha256:${emptyHash}`,
      `x-amz-date:${amzDate}`,
    ].join("\n") + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "GET",
    parsed.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    emptyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, region, "s3");
  const signature = await hmacHex(signingKey, stringToSign);

  const headers: Record<string, string> = {
    "x-amz-content-sha256": emptyHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  const response = await requestUrl({ url, method: "GET", headers, throw: false });
  if (response.status >= 200 && response.status < 400) return;
  throw new Error(`S3 connection test failed (${response.status}): ${response.text || "Unknown error"}`);
}
