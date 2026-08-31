import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

const [pkg, lock, manifest, versions] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("manifest.json"),
  readJson("versions.json"),
]);

const version = String(manifest.version || "");
const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`Invalid manifest version: ${version}`);
const description = String(manifest.description || "");
if (/obsidian/i.test(description)) {
  errors.push('manifest description must not contain the word "Obsidian"');
}
if (description.length > 250) errors.push("manifest description must be at most 250 characters");
if (!description.endsWith(".")) errors.push("manifest description must end with a period");
if (pkg.version !== version) errors.push(`package.json is ${pkg.version}, expected ${version}`);
if (lock.version !== version) errors.push(`package-lock.json is ${lock.version}, expected ${version}`);
if (lock.packages?.[""]?.version !== version) {
  errors.push(`package-lock root package is ${lock.packages?.[""]?.version}, expected ${version}`);
}
if (versions[version] !== manifest.minAppVersion) {
  errors.push(`versions.json[${version}] must equal minAppVersion ${manifest.minAppVersion}`);
}

const tag = process.env.RELEASE_TAG ||
  (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "") ||
  "";
if (tag && tag !== version) errors.push(`Release tag ${tag} must exactly match manifest version ${version}`);

if (errors.length > 0) {
  throw new Error(`Release metadata validation failed:\n- ${errors.join("\n- ")}`);
}

process.stdout.write(`Release metadata is consistent: ${version}\n`);
