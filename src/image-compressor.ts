/**
 * Image compression module using @jsquash WASM codecs.
 *
 * Strategy: Read WASM binaries from the plugin directory at runtime
 * using Node.js fs, then manually initialize the WASM modules via
 * WebAssembly.compile(). This avoids import.meta.url issues in
 * Obsidian's CJS bundle environment.
 */
import { init as initWebpEnc, default as encodeWebp } from "@jsquash/webp/encode";
import type { EncodeOptions } from "@jsquash/webp/meta";
import webpEncWasm from "../node_modules/@jsquash/webp/codec/enc/webp_enc.wasm";

export interface CompressResult {
  body: Uint8Array;
  ext: string;
  contentType: string;
  originalSize: number;
  compressedSize: number;
}

let wasmInitialized = false;



/**
 * Initialize WASM modules (lazy, once).
 */
async function ensureWasmInit(): Promise<void> {
  if (wasmInitialized) return;
  try {
    const wasmModule = await WebAssembly.compile(webpEncWasm.buffer);
    await initWebpEnc(wasmModule);
    wasmInitialized = true;
  } catch (e) {
    console.error("Failed to initialize WebP WASM encoder:", e);
    throw e;
  }
}

/**
 * Decode an image binary into raw RGBA ImageData.
 * Uses browser-native createImageBitmap + OffscreenCanvas for decoding.
 * This is NOT the same as using Canvas for encoding — decoding via
 * createImageBitmap is lossless for the source format.
 */
async function decodeImage(binary: ArrayBuffer, ext: string): Promise<ImageData> {
  const lowerExt = ext.toLowerCase();

  // Use createImageBitmap for universal decoding (available in Electron)
  const blob = new Blob([binary], { type: mimeForExt(lowerExt) });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get OffscreenCanvas 2D context");
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imageData;
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    bmp: "image/bmp",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
    ico: "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Compress an image to WebP format using WASM-based libwebp encoder.
 * @param binary - Raw image file bytes
 * @param ext - Original file extension (png, jpg, jpeg, bmp, webp, etc.)
 * @param quality - Quality 0-100
 */
export async function compressToWebp(
  binary: ArrayBuffer,
  ext: string,
  quality: number
): Promise<CompressResult> {
  await ensureWasmInit();
  const imageData = await decodeImage(binary, ext);
  const options: Partial<EncodeOptions> = { quality };
  const webpBuffer = await encodeWebp(imageData, options);
  const body = new Uint8Array(webpBuffer);

  return {
    body,
    ext: "webp",
    contentType: "image/webp",
    originalSize: binary.byteLength,
    compressedSize: body.byteLength,
  };
}
