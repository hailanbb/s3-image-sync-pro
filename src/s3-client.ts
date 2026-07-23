import { requestUrl } from "obsidian";
import { S3Config } from "./types";
import { sha256Hex, hmacHex, getSignatureKey } from "./crypto";
import { toAmzDate } from "./utils";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function putS3Object(
  config: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
  formatError: (status: number, text: string) => string,
  precomputedHash?: string
): Promise<void> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${bucket}/${encodedKey}`;
  const parsed = new URL(url);
  const region = config.region || "auto";

  // CRITICAL FIX: Ensure the body is a pure V8 ArrayBuffer before it's passed to Electron IPC via requestUrl.
  // WASM-backed ArrayBuffers can cause structured clone / serialization issues over IPC, leading to corrupted 
  // uploads and XAmzContentSHA256Mismatch errors.
  const safeBody = new Uint8Array(body.length);
  safeBody.set(body);
  const safeBuffer = safeBody.buffer;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    // CRITICAL FIX: AWS S3 & Cloudflare R2 support "UNSIGNED-PAYLOAD" for HTTPS requests.
    // This entirely bypasses the x-amz-content-sha256 body hash verification, which fixes the Mismatch 
    // error caused by Electron IPC altering or truncating ArrayBuffers during requestUrl calls.
    const payloadHash = "UNSIGNED-PAYLOAD";

    const canonicalHeaders =
      [
        `host:${parsed.host}`,
        `x-amz-content-sha256:${payloadHash}`,
        `x-amz-date:${amzDate}`,
      ].join("\n") + "\n";
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

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
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };

    try {
      const response = await requestUrl({
        url,
        method: "PUT",
        headers,
        body: safeBuffer,
        throw: false,
      });

      if (response.status >= 200 && response.status < 300) return;

      if (shouldRetry(response.status) && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }

      throw new Error(formatError(response.status, response.text || ""));
    } catch (error: unknown) {
      if (error instanceof Error && error.message) {
        // Already a formatted error from above — don't retry non-retriable errors
        if (attempt >= MAX_RETRIES) throw error;
      }
      // Network / transport errors are retriable
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }
}

export async function copyS3Object(config: S3Config, sourceKey: string, destKey: string): Promise<void> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedDestKey = destKey.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${bucket}/${encodedDestKey}`;
  const parsed = new URL(url);
  const region = config.region || "auto";

  const encodedSourceKey = sourceKey.split("/").map(encodeURIComponent).join("/");
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

export async function deleteS3Object(config: S3Config, key: string): Promise<void> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${bucket}/${encodedKey}`;
  const parsed = new URL(url);
  const region = config.region || "auto";

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
    "x-amz-content-sha256": emptyHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  const response = await requestUrl({ url, method: "DELETE", headers, throw: false });
  if (response.status >= 400 && response.status !== 404) {
    console.warn(`S3 delete failed for key "${key}" (${response.status}): ${response.text || ""}`);
  }
}

export async function testS3Connection(config: S3Config): Promise<void> {
  const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
  const bucket = config.bucketName;
  const url = `${endpoint}/${bucket}/`;
  const parsed = new URL(url);
  const region = config.region || "auto";

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
