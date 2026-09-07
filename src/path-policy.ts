export const PATH_MODES = ["ignore", "staging", "managed", "verify"] as const;

export type PathMode = (typeof PATH_MODES)[number];
export type ProcessingScopeMode = "legacy" | "policy";

export interface PathPolicyRule {
  path: string;
  mode: PathMode;
}

export interface PathPolicyConfig {
  processingScopeMode?: ProcessingScopeMode;
  excludedNotePaths?: readonly string[];
  pathPolicies?: readonly PathPolicyRule[];
}

const PATH_MODE_PRIORITY: Readonly<Record<PathMode, number>> = {
  ignore: 4,
  verify: 3,
  managed: 2,
  staging: 1,
};

const PATH_MODE_ALIASES: Readonly<Record<string, PathMode>> = {
  ignore: "ignore",
  ignored: "ignore",
  忽略: "ignore",
  不处理: "ignore",
  staging: "staging",
  stage: "staging",
  暂存: "staging",
  入箱保护: "staging",
  managed: "managed",
  manage: "managed",
  管理: "managed",
  完整管理: "managed",
  完整同步: "managed",
  verify: "verify",
  verification: "verify",
  audit: "verify",
  校验: "verify",
  核验: "verify",
  只读校验: "verify",
  仅校验: "verify",
};

/** Normalize a vault-relative path without depending on Obsidian APIs. */
export function normalizePolicyPath(path: string): string {
  const trimmed = String(path || "").trim();
  if (trimmed === "/" || trimmed === ".") return "";

  return trimmed
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+|\/+$/g, "");
}

function isPathMode(value: unknown): value is PathMode {
  return typeof value === "string" && (PATH_MODES as readonly string[]).includes(value);
}

function matchesPath(path: string, root: string): boolean {
  return root === "" || path === root || path.startsWith(`${root}/`);
}

function normalizedRule(rule: PathPolicyRule): PathPolicyRule | null {
  const rawPath = String(rule?.path || "").trim();
  if (!rawPath || !isPathMode(rule?.mode)) return null;

  return {
    path: normalizePolicyPath(rawPath),
    mode: rule.mode,
  };
}

/**
 * Resolve the effective policy for a note or folder path.
 *
 * Legacy mode keeps the historical behavior: excluded roots are ignored and
 * every other path is fully managed. Policy mode uses the longest matching
 * rule and defaults unmatched paths to ignore. Equal-length rules are resolved
 * conservatively: ignore > verify > managed > staging.
 */
export function getPathMode(notePath: string, config: PathPolicyConfig): PathMode {
  const normalizedPath = normalizePolicyPath(notePath);

  if (config.processingScopeMode !== "policy") {
    const isExcluded = (config.excludedNotePaths || []).some((excludedPath) => {
      const rawRoot = String(excludedPath || "").trim();
      return rawRoot !== "" && matchesPath(normalizedPath, normalizePolicyPath(rawRoot));
    });
    return isExcluded ? "ignore" : "managed";
  }

  let bestRule: PathPolicyRule | null = null;
  for (const candidate of config.pathPolicies || []) {
    const rule = normalizedRule(candidate);
    if (!rule || !matchesPath(normalizedPath, rule.path)) continue;

    if (
      !bestRule ||
      rule.path.length > bestRule.path.length ||
      (rule.path.length === bestRule.path.length &&
        PATH_MODE_PRIORITY[rule.mode] > PATH_MODE_PRIORITY[bestRule.mode])
    ) {
      bestRule = rule;
    }
  }

  return bestRule?.mode || "ignore";
}

/** Whether the plugin may upload, download, rewrite, or delete for this mode. */
export function canMutate(mode: PathMode): boolean {
  return mode === "staging" || mode === "managed";
}

/** Whether note/image paths may be migrated for this mode. */
export function canPathSync(mode: PathMode): boolean {
  return mode === "managed";
}

/** Whether canonical path differences should be reported for this mode. */
export function canCheckPath(mode: PathMode): boolean {
  return mode === "managed" || mode === "verify";
}

/** Whether the path participates in read-only consistency checks. */
export function canAudit(mode: PathMode): boolean {
  return mode !== "ignore";
}

function parsePathMode(value: string): PathMode | null {
  return PATH_MODE_ALIASES[String(value || "").trim().toLowerCase()] || null;
}

/** Parse one `mode: vault/path` rule per line. Invalid or blank lines are skipped. */
export function parsePathPolicyLines(value: string): PathPolicyRule[] {
  const rules: PathPolicyRule[] = [];

  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const separatorIndex = line.search(/[:：]/);
    if (separatorIndex < 1) continue;

    const mode = parsePathMode(line.slice(0, separatorIndex));
    const rawPath = line.slice(separatorIndex + 1).trim();
    if (!mode || !rawPath) continue;

    const path = normalizePolicyPath(rawPath);
    rules.push({ path: path || "/", mode });
  }

  return rules;
}

/** Report invalid draft lines without changing the active rules. */
export function invalidPathPolicyLines(value: string): number[] {
  return value.split(/\r?\n/).flatMap((line, index) =>
    line.trim() && parsePathPolicyLines(line).length !== 1 ? [index + 1] : []
  );
}

/** Format rules in the canonical, language-neutral `mode: vault/path` form. */
export function formatPathPolicyLines(rules: readonly PathPolicyRule[]): string {
  return (rules || [])
    .map(normalizedRule)
    .filter((rule): rule is PathPolicyRule => rule !== null)
    .map((rule) => `${rule.mode}: ${rule.path || "/"}`)
    .join("\n");
}
