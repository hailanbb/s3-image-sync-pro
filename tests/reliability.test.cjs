const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
class TFile {}
class Notice { setMessage() {} hide() {} }
const obsidian = { Plugin: class {}, TFile, TFolder: class {}, Notice };
function load(file) {
  file = path.resolve(__dirname, '..', file);
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === 'obsidian') return obsidian;
    if (['./utils', './settings', './path-policy', './link-parser', './i18n', './serialized-async-queue'].includes(id)) {
      return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), id + '.ts')));
    }
    return {};
  };
  new Function('module', 'exports', 'require', output)(module, module.exports, localRequire);
  cache.set(file, module.exports);
  return module.exports;
}
const { extractLocalRefs, extractRemoteImageRefs, rewriteLinkRefs } = load('src/link-parser.ts');
const { buildLinkReplacement, replaceRefTarget } = load('src/utils.ts');
const { invalidPathPolicyLines } = load('src/path-policy.ts');
const { DEFAULT_SETTINGS, mergeSettings } = load('src/settings.ts');
const Plugin = load('src/plugin.ts').default;

for (const [input, expected] of [
  ['![图](目录/image%23one.png)', '目录/image#one.png'],
  ['![图](image(1).png)', 'image(1).png'],
  ['![图](image\\(1\\).png)', 'image(1).png'],
  ['![图](image.png "标题")', 'image.png'],
  ["![图](image.png '标题')", 'image.png'],
  ['![图](<中文 目录/image(1).png> "标题")', '中文 目录/image(1).png'],
  ['![[目录/image%23one.png|200]]', '目录/image#one.png'],
  ['![图](literal%2520name.png)', 'literal%20name.png'],
]) {
  const refs = extractLocalRefs(input);
  assert.equal(refs.length, 1, input);
  assert.equal(refs[0].target, expected, input);
  assert.equal(refs[0].raw, input);
}
assert.equal(extractLocalRefs('![图](image%23one.png#section)')[0].fragment, 'section');
const image = '![图](image.png "保留标题")';
const doc = `${image}\n${image}\n\n\x60\x60\x60md\n${image}\n\x60\x60\x60\n\x60${image}\x60\n<!-- ${image} -->`;
const replacement = buildLinkReplacement(extractLocalRefs(image)[0], 'image', 'https://cdn.test/new.png');
assert.equal(replacement, '![图](https://cdn.test/new.png "保留标题")');
assert.equal(buildLinkReplacement(extractLocalRefs(image)[0], 'markdown', 'https://cdn.test/new.png'), '[图](https://cdn.test/new.png "保留标题")');
const rewritten = rewriteLinkRefs(doc, new Map([[image, replacement]]));
assert.equal(rewritten.count, 2);
assert.equal(rewritten.text, doc.replace(image, replacement).replace(image, replacement));
assert.equal(rewriteLinkRefs(`\x60${image}\x60`, new Map([[image, replacement]])).count, 0);
assert.equal(extractLocalRefs(`~~~md\n${image}`).length, 0);
assert.equal(extractLocalRefs(`  \x60\x60\x60md\n${image}\n  \x60\x60\x60\x60\n${image}`).length, 1);
assert.equal(extractLocalRefs(`\\${image}`).length, 0);
const remote = extractRemoteImageRefs('![图](<https://cdn.test/a(1).png> "标题")')[0];
assert.equal(remote.url, 'https://cdn.test/a(1).png');
assert.equal(replaceRefTarget(remote, 'mirror/a.png'), '![图](<mirror/a.png> "标题")');
assert.deepEqual(invalidPathPolicyLines('managed: 正式\nignore\n\nverify: 只读'), [2]);

let timerId = 0;
global.window = { setTimeout: () => ++timerId, clearTimeout() {}, clearInterval() {} };
function fixture(saved) {
  const plugin = new Plugin();
  plugin.settings = mergeSettings(DEFAULT_SETTINGS, saved || { linkMode: 'cloud' });
  plugin.snapshots = [];
  plugin.saveSettings = async () => { plugin.snapshots.push(JSON.parse(JSON.stringify(plugin.settings))); };
  plugin.addLog = () => {};
  plugin.t = (key) => key;
  const file = Object.assign(new TFile(), { path: '收件箱/中文.md', extension: 'md', stat: { mtime: 1, size: 1 } });
  return { plugin, file };
}

async function main() {
  const first = fixture();
  first.plugin.performBackgroundImageSync = async () => {
    assert(first.plugin.snapshots.at(-1).startupCatchupPendingPaths.includes(first.file.path), 'persist before upload');
    return false;
  };
  assert.equal(await first.plugin.autoTransferRemoteForFile(first.file), false);
  assert(first.plugin.settings.startupCatchupPendingPaths.includes(first.file.path));
  const restarted = fixture(first.plugin.snapshots.at(-1));
  assert(restarted.plugin.settings.startupCatchupPendingPaths.includes(first.file.path), 'failed work survives reload');
  restarted.plugin.performBackgroundImageSync = async () => true;
  assert.equal(await restarted.plugin.autoTransferRemoteForFile(restarted.file), true);
  assert.deepEqual(restarted.plugin.settings.startupCatchupPendingPaths, []);

  const concurrent = fixture();
  let finish;
  let starts = 0;
  concurrent.plugin.performBackgroundImageSync = () => { starts++; return new Promise((resolve) => { finish = resolve; }); };
  const run1 = concurrent.plugin.autoTransferRemoteForFile(concurrent.file);
  const run2 = concurrent.plugin.autoTransferRemoteForFile(concurrent.file);
  await Promise.resolve();
  concurrent.plugin.backgroundRevisions.set(concurrent.file.path, 1);
  finish(true);
  assert.deepEqual(await Promise.all([run1, run2]), [false, false]);
  assert.equal(starts, 1);
  assert(concurrent.plugin.settings.startupCatchupPendingPaths.includes(concurrent.file.path), 'new edits cannot be acknowledged by old run');

  const partial = fixture();
  partial.plugin.settings.linkMode = 'local';
  partial.plugin.settings.autoTransferRemoteImages = true;
  partial.plugin.ensureS3Settings = () => {};
  partial.plugin.findRemoteCandidatesInNote = async () => [{}];
  partial.plugin.transferRemoteImagesInNote = async () => ({ replaced: 1, failed: 1 });
  assert.equal(await partial.plugin.performBackgroundImageSync(partial.file, true), false, 'partial transfers must retry');

  const shutdown = fixture();
  shutdown.plugin.onunload();
  shutdown.plugin.performBackgroundImageSync = () => { throw new Error('must not start after unload'); };
  assert.equal(await shutdown.plugin.autoTransferRemoteForFile(shutdown.file), false);

  // Exercise the actual write callback, not only the standalone rewrite helper.
  const integration = fixture();
  let content = doc;
  integration.plugin.app = { vault: { process: async (_file, fn) => { content = fn(content); } } };
  integration.plugin.ensureS3Settings = () => {};
  integration.plugin.uploadCandidate = async () => ({ publicUrl: 'https://cdn.test/new.png', targetNotePath: integration.file.path });
  integration.plugin.buildLocalFileRecords = () => [];
  const candidate = { file: { path: 'image.png', name: 'image.png' }, replacement: 'image', refs: extractLocalRefs(doc) };
  const result = await integration.plugin.replaceCandidates(integration.file, [candidate], null, 'cloud', false);
  assert.equal(result.replaced, 2);
  assert.equal(content, rewritten.text);

  // Migration maps must contain complete refs, not URL/path substrings.
  const oldKey = 'old/image%20name.png';
  const newKey = '新位置/image%20name.png';
  const wikiText = '![[98 cloudflareR2/old/image%2520name.png|200]]';
  integration.plugin.getLocalMirrorPathForCloudKey = (key) => '98 cloudflareR2/' + key;
  const mappings = new Map();
  const owners = new Map();
  integration.plugin.addPathReplacements({ s3: { customDomainName: 'https://cdn.test' }, mirrorRoot: '98 cloudflareR2' }, mappings, owners, wikiText, oldKey, newKey);
  assert.equal(mappings.size, 1);
  assert.equal(mappings.get(wikiText), '![[98%20cloudflareR2/%E6%96%B0%E4%BD%8D%E7%BD%AE/image%2520name.png|200]]');
  assert.equal(rewriteLinkRefs(wikiText + '\nplain old/image%20name.png', mappings).count, 1);
  assert.equal(integration.plugin.extractRemoteUrls(wikiText)[0], oldKey, 'reference protection decodes once');

  const rename = fixture();
  rename.plugin.ensureS3Settings = () => {};
  rename.plugin.syncS3PathsForNote = async () => ({ fixed: 0, skipped: 0, failed: 1 });
  await rename.plugin.syncS3PathsOnRename(rename.file, '旧位置.md');
  assert(rename.plugin.snapshots.at(-1).startupCatchupPendingPaths.includes(rename.file.path));
  console.log('Reliability tests passed: parsing, exact writes, durable retries, concurrency, partial failures, unload and policies');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
