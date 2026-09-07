import type { LocalRef, RemoteImageRef } from "./types";

function decodeLinkPath(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
}

function splitFragment(value: string): { path: string; fragment: string } {
  // Split syntax BEFORE decoding: %23 belongs to the filename.
  const index = value.indexOf("#");
  return {
    path: decodeLinkPath(index < 0 ? value : value.slice(0, index)),
    fragment: index < 0 ? "" : decodeLinkPath(value.slice(index + 1)),
  };
}

function escaped(text: string, index: number): boolean {
  let count = 0;
  while (index > 0 && text[--index] === "\\") count++;
  return count % 2 === 1;
}

function inRegion(pos: number, regions: Array<[number, number]>): boolean {
  return regions.some(([start, end]) => pos >= start && pos < end);
}

function findCodeRegions(text: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let fence: { start: number; char: string; length: number } | undefined;
  const lines = /^.*(?:\n|$)/gm;
  let line: RegExpExecArray | null;
  while ((line = lines.exec(text)) && line[0]) {
    const marker = /^ {0,3}([\x60]{3,}|~{3,})(.*)\r?\n?$/.exec(line[0]);
    if (!marker) continue;
    if (!fence) {
      fence = { start: line.index, char: marker[1][0], length: marker[1].length };
    } else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
      regions.push([fence.start, line.index + line[0].length]);
      fence = undefined;
    }
  }
  if (fence) regions.push([fence.start, text.length]);
  const inline = /[\x60]+/g;
  let run: RegExpExecArray | null;
  while ((run = inline.exec(text))) {
    if (inRegion(run.index, regions) || escaped(text, run.index)) continue;
    const closing = /[\x60]+/g;
    closing.lastIndex = inline.lastIndex;
    let end: RegExpExecArray | null;
    while ((end = closing.exec(text))) {
      if (end[0].length !== run[0].length) continue;
      regions.push([run.index, closing.lastIndex]);
      inline.lastIndex = closing.lastIndex;
      break;
    }
  }
  const comments = /<!--[\s\S]*?(?:-->|$)/g;
  let comment: RegExpExecArray | null;
  while ((comment = comments.exec(text))) regions.push([comment.index, comments.lastIndex]);
  return regions;
}

interface MarkdownRef {
  raw: string;
  start: number;
  end: number;
  destinationStart: number;
  destinationEnd: number;
  href: string;
  label: string;
  embed: boolean;
}

function markdownRefs(text: string, regions: Array<[number, number]>): MarkdownRef[] {
  const refs: MarkdownRef[] = [];
  const opening = /!?\[/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    const start = match.index;
    if (escaped(text, start) || inRegion(start, regions)) continue;
    const labelStart = opening.lastIndex;
    if (text[labelStart] === "[" || text[start - 1] === "[") continue;
    let labelEnd = labelStart;
    let depth = 1;
    for (; labelEnd < text.length; labelEnd++) {
      const char = text[labelEnd];
      if (char === "\n") break;
      if (escaped(text, labelEnd)) continue;
      if (char === "[") depth++;
      if (char === "]") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0 || text[labelEnd + 1] !== "(") continue;
    const bodyStart = labelEnd + 2;
    let end = bodyStart;
    let parentheses = 1;
    let quote = "";
    let angle = false;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === "\n" || char === "\r") break;
      if (escaped(text, end)) continue;
      if (quote) { if (char === quote) quote = ""; continue; }
      if (angle) { if (char === ">") angle = false; continue; }
      if (char === "<" && !text.slice(bodyStart, end).trim()) { angle = true; continue; }
      if ((char === '"' || char === "'") && /\s/.test(text[end - 1] || "")) { quote = char; continue; }
      if (char === "(") parentheses++;
      if (char === ")") { parentheses--; if (parentheses === 0) break; }
    }
    if (parentheses !== 0) continue;
    const body = text.slice(bodyStart, end);
    const trimmed = body.trim();
    let offset = bodyStart + body.length - body.trimStart().length;
    let href: string;
    if (trimmed.startsWith("<")) {
      const close = trimmed.indexOf(">");
      if (close < 0) continue;
      href = trimmed.slice(1, close);
      offset++;
    } else {
      // Keep legacy spaces, but separate the optional Markdown title.
      href = trimmed.replace(/\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^()]*\))\s*$/, "");
    }
    if (!href) continue;
    refs.push({
      raw: text.slice(start, end + 1), start, end: end + 1,
      destinationStart: offset - start, destinationEnd: offset - start + href.length,
      href: href.replace(/\\([\\()[\]<> ])/g, "$1"),
      label: text.slice(labelStart, labelEnd), embed: match[0].startsWith("!"),
    });
    opening.lastIndex = end + 1;
  }
  return refs;
}

export function extractLocalRefs(text: string): LocalRef[] {
  const refs: LocalRef[] = [];
  const regions = findCodeRegions(text);
  const wiki = /!?\[\[([^\]\n]+?)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(text))) {
    if (escaped(text, match.index) || inRegion(match.index, regions)) continue;
    const inner = match[1];
    const pipe = inner.indexOf("|");
    const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
    const parsed = splitFragment(target);
    const offset = match[0].indexOf("[[") + 2 + inner.indexOf(target);
    refs.push({
      kind: match[0].startsWith("!") ? "wiki-embed" : "wiki",
      raw: match[0], start: match.index, end: wiki.lastIndex,
      destinationStart: offset, destinationEnd: offset + target.length,
      target: parsed.path, fragment: parsed.fragment,
      label: (pipe < 0 ? "" : inner.slice(pipe + 1)) || parsed.path.split("/").pop() || parsed.path,
    });
  }
  for (const ref of markdownRefs(text, regions)) {
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(ref.href)) continue;
    const parsed = splitFragment(ref.href);
    refs.push({
      kind: ref.embed ? "markdown-embed" : "markdown",
      raw: ref.raw, start: ref.start, end: ref.end,
      destinationStart: ref.destinationStart, destinationEnd: ref.destinationEnd,
      target: parsed.path, fragment: parsed.fragment,
      label: ref.label || parsed.path.split("/").pop() || parsed.path,
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
  } catch { /* Invalid URLs are rejected by the caller. */ }
  return "png";
}

export function isImageUrl(url: string): boolean { return IMAGE_EXTS.has(guessExtFromUrl(url)); }

export function extractRemoteImageRefs(text: string): RemoteImageRef[] {
  return markdownRefs(text, findCodeRegions(text))
    .filter((ref) => ref.embed && /^https?:/i.test(ref.href) && isImageUrl(ref.href))
    .map((ref) => ({
      raw: ref.raw, start: ref.start, end: ref.end, url: ref.href, alt: ref.label,
      destinationStart: ref.destinationStart, destinationEnd: ref.destinationEnd,
    }));
}

/** Reparse CURRENT content and change only recognized spans, never code examples. */
export function rewriteLinkRefs(text: string, replacements: ReadonlyMap<string, string>): {
  text: string; count: number; applied: Set<string>;
} {
  const refs = [...extractLocalRefs(text), ...extractRemoteImageRefs(text)].sort((a, b) => b.start - a.start);
  let next = text;
  let count = 0;
  let boundary = text.length;
  const applied = new Set<string>();
  for (const ref of refs) {
    const replacement = replacements.get(ref.raw);
    if (replacement === undefined || replacement === ref.raw || ref.end > boundary) continue;
    next = next.slice(0, ref.start) + replacement + next.slice(ref.end);
    boundary = ref.start;
    applied.add(ref.raw);
    count++;
  }
  return { text: next, count, applied };
}
