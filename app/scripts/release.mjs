#!/usr/bin/env node
/**
 * Cuts a Cosmos release: one version for the agent, the web UI it serves and
 * the desktop app. Sets it everywhere, commits, and tags `v<version>` (the
 * agent image, .github/workflows/agent-image.yml) and `app-v<version>` (the
 * desktop installers, .github/workflows/app-release.yml).
 *
 *   npm run release -- 0.6.0          bump, commit and tag locally
 *   npm run release -- 0.6.0 --push   ...and push the commit and both tags
 *
 * The version lives in app/package.json (tauri.conf.json reads it from there,
 * and the web UI shows it), app/src-tauri/Cargo.toml, cosmos-agent/Cargo.toml
 * and cosmos-common/Cargo.toml, kept in step here.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(appDir, '..');
const files = {
  pkg: path.join(appDir, 'package.json'),
  lock: path.join(appDir, 'package-lock.json'),
  cargoLock: path.join(root, 'Cargo.lock'),
};
/** Crate name (as in Cargo.lock) -> its Cargo.toml. */
const crates = {
  app: path.join(appDir, 'src-tauri/Cargo.toml'),
  'cosmos-agent': path.join(root, 'cosmos-agent/Cargo.toml'),
  'cosmos-common': path.join(root, 'cosmos-common/Cargo.toml'),
};

const crateVersion = (file) => readFileSync(file, 'utf8').match(/^version = "([^"]*)"/m)?.[1];

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Negative when a < b. Pre-releases sort before their release. */
function compare(a, b) {
  const [, ...pa] = a.match(SEMVER);
  const [, ...pb] = b.match(SEMVER);
  for (let i = 0; i < 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  if (pa[3] === pb[3]) return 0;
  if (!pa[3]) return 1;
  if (!pb[3]) return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

const args = process.argv.slice(2);
const push = args.includes('--push');
const version = args.find((a) => !a.startsWith('--'))?.replace(/^v/, '');

if (!version) fail('usage: npm run release -- <version> [--push]   e.g. 0.2.0 or 0.2.0-beta.1');
if (!SEMVER.test(version)) fail(`"${version}" is not a version like 1.2.3 or 1.2.3-beta.1`);

const tags = [`v${version}`, `app-v${version}`];
// Newer than every part, since they used to be versioned apart.
const current = [JSON.parse(readFileSync(files.pkg, 'utf8')).version, ...Object.values(crates).map(crateVersion)]
  .filter((v) => v && SEMVER.test(v))
  .sort(compare)
  .at(-1);

// Preconditions, all checked before anything is written.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`releases are cut from main, not ${branch}`);
if (git('status', '--porcelain', '--untracked-files=no')) {
  fail('commit or stash your changes first; the release commit should only bump the version');
}
git('fetch', '--quiet', '--tags', 'origin');
if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') fail('main is behind origin/main; pull first');
for (const tag of tags) if (git('tag', '--list', tag)) fail(`${tag} already exists`);
if (compare(version, current) <= 0) fail(`${version} is not newer than the current ${current}`);

// package.json + package-lock.json
for (const file of [files.pkg, files.lock]) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

// Each Cargo.toml: the [package] version is the first `version =` line. In
// Cargo.lock, rewrite only these crates' entries, never a dependency's.
let lock = readFileSync(files.cargoLock, 'utf8');
for (const [name, file] of Object.entries(crates)) {
  const cargo = readFileSync(file, 'utf8');
  const bumped = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  if (bumped === cargo && crateVersion(file) !== version) fail(`could not find the version in ${path.relative(root, file)}`);
  writeFileSync(file, bumped);

  const entry = new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]*(")`);
  if (!entry.test(lock)) fail(`could not find ${name} in Cargo.lock`);
  lock = lock.replace(entry, `$1${version}$2`);
}
writeFileSync(files.cargoLock, lock);

git('add', files.pkg, files.lock, files.cargoLock, ...Object.values(crates));
git('commit', '--quiet', '-m', `Release v${version}`);
for (const tag of tags) git('tag', '-a', tag, '-m', `Cosmos ${version}`);
console.log(`Bumped ${current} -> ${version}, committed and tagged ${tags.join(' and ')}.`);

if (push) {
  git('push', '--quiet', 'origin', 'main');
  git('push', '--quiet', 'origin', ...tags);
  console.log('Pushed. Building the agent image and a draft desktop release:');
  console.log('  https://github.com/Sunstead/Cosmos/actions/workflows/agent-image.yml');
  console.log('  https://github.com/Sunstead/Cosmos/actions/workflows/app-release.yml');
} else {
  console.log('Nothing pushed. When ready:');
  console.log(`  git push origin main && git push origin ${tags.join(' ')}`);
  console.log('To undo instead:');
  console.log(`  git tag -d ${tags.join(' ')} && git reset --hard HEAD~1`);
}
