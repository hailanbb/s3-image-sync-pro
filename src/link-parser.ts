import { LocalRef } from "./types";

function splitFragment(path: string): { path: string; fragment: string } {
  const hashIndex = path.indexOf("#");
  if (hashIndex === -1) return { path, fragment: "" };
  return { path: path.slice(0, hashIndex), fragment: path.slice(hashIndex + 1) };
}

function decodeLinkPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function basename(path: string): string {
  return String(path || "").split("/").pop() || path;
}

function findCodeRegions(text: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const fenced = /^(`{3,}|~{3,}).*?\n[\s\S]*?^\1/gm;
  let m: RegExpExecArray | null;
  while ((m = fenced.exec(text)) !== null) {
    regions.push([m.index, m.index + m[0].length]);
  }
  const inline = /(`+)([\s\S]+?)\1/g;
  while ((m = inline.exec(text)) !== null) {
    regions.push([m.index, m.index + m[0].length]);
  }
  return regions;
}

function isInCodeRegion(pos: number, regions: Array<[number, number]>): boolean {
  for (const [start, end] of regions) {
    if (pos >= start && pos < end) return true;
  }
  return false;
}

export function extractLocalRefs(text: string): LocalRef[] {
  const refs: LocalRef[] = [];
  const codeRegions = findCodeRegions(text);

  const wiki = /!?\[\[([^\]\n]+?)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(text)) !== null) {
    if (isInCodeRegion(match.index, codeRegions)) continue;
    const raw = match[0];
    const inner = match[1];
    const pipeIndex = inner.indexOf("|");
    const targetPart = pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
    const alias = pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : "";
    const parsed = splitFragment(targetPart.trim());
    refs.push({
      kind: raw.startsWith("!") ? "wiki-embed" : "wiki",
      raw,
      start: match.index,
      end: match.index + raw.length,
      target: parsed.path,
      fragment: parsed.fragment,
      label: alias || basename(parsed.path),
    });
  }

  const markdown = /!?\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  while ((match = markdown.exec(text)) !== null) {
    if (isInCodeRegion(match.index, codeRegions)) continue;
    const raw = match[0];
    let href = match[2].trim();
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    if (/^(https?:|mailto:|obsidian:|#)/i.test(href)) continue;
    const parsed = splitFragment(decodeLinkPath(href));
    refs.push({
      kind: raw.startsWith("!") ? "markdown-embed" : "markdown",
      raw,
      start: match.index,
      end: match.index + raw.length,
      target: parsed.path,
      fragment: parsed.fragment,
      label: match[1] || basename(parsed.path),
    });
  }

  return refs.sort((a, b) => a.start - b.start);
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "heic", "avif", "ico"]);

export function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot >= 0) {
      const ext = pathname.slice(lastDot + 1).toLowerCase().split(/[?#]/)[0];
      if (ext && ext.length <= 5) return ext;
    }
  } catch { /* ignore */ }
  return "png"; // fallback for extensionless URLs (common in CDNs)
}

export function isImageUrl(url: string): boolean {
  const ext = guessExtFromUrl(url);
  return IMAGE_EXTS.has(ext);
}

import { RemoteImageRef } from "./types";

export function extractRemoteImageRefs(text: string): RemoteImageRef[] {
  const refs: RemoteImageRef[] = [];
  const codeRegions = findCodeRegions(text);

  // Match ![alt](https://...) — standard markdown image embeds with http(s) URLs
  const mdImg = /!\[([^\]\n]*)\]\((https?:\/\/[^)\n]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdImg.exec(text)) !== null) {
    if (isInCodeRegion(match.index, codeRegions)) continue;
    const raw = match[0];
    const alt = match[1];
    const url = match[2].trim();
    // Only include URLs that look like images
    if (!isImageUrl(url)) continue;
    refs.push({
      raw,
      start: match.index,
      end: match.index + raw.length,
      url,
      alt,
    });
  }

  return refs.sort((a, b) => a.start - b.start);
}
