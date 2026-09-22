#!/usr/bin/env node
/**
 * Cuts a desktop app release: sets the version, commits, tags `app-v<version>`.
 * Pushing the tag starts .github/workflows/app-release.yml.
 *
 *   npm run release -- 0.2.0          bump, commit and tag locally
 *   npm run release -- 0.2.0 --push   ...and push the commit and tag
 *
 * The version lives in app/package.json (tauri.conf.json reads it from there)
 * and app/src-tauri/Cargo.toml, kept in sync here.
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
  cargo: path.join(appDir, 'src-tauri/Cargo.toml'),
  cargoLock: path.join(root, 'Cargo.lock'),
};

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

const tag = `app-v${version}`;
const current = JSON.parse(readFileSync(files.pkg, 'utf8')).version;

// Preconditions, all checked before anything is written.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`releases are cut from main, not ${branch}`);
if (git('status', '--porcelain', '--untracked-files=no')) {
  fail('commit or stash your changes first; the release commit should only bump the version');
}
git('fetch', '--quiet', '--tags', 'origin');
if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') fail('main is behind origin/main; pull first');
if (git('tag', '--list', tag)) fail(`${tag} already exists`);
if (compare(version, current) <= 0) fail(`${version} is not newer than the current ${current}`);

// package.json + package-lock.json
for (const file of [files.pkg, files.lock]) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

// Cargo.toml: the [package] version is the first `version =` line.
const cargo = readFileSync(files.cargo, 'utf8');
const bumped = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`);
if (bumped === cargo) fail('could not find the version in src-tauri/Cargo.toml');
writeFileSync(files.cargo, bumped);

// Cargo.lock: rewrite only the app crate's entry, without touching dependencies.
const lock = readFileSync(files.cargoLock, 'utf8');
const lockBumped = lock.replace(
  /(\[\[package\]\]\nname = "app"\nversion = ")[^"]*(")/,
  `$1${version}$2`,
);
if (lockBumped === lock) fail('could not find the app crate in Cargo.lock');
writeFileSync(files.cargoLock, lockBumped);

git('add', files.pkg, files.lock, files.cargo, files.cargoLock);
git('commit', '--quiet', '-m', `Release app v${version}`);
git('tag', '-a', tag, '-m', `Cosmos ${version}`);
console.log(`Bumped ${current} -> ${version}, committed and tagged ${tag}.`);

if (push) {
  git('push', '--quiet', 'origin', 'main');
  git('push', '--quiet', 'origin', tag);
  console.log('Pushed. The release workflow is building a draft release:');
  console.log('  https://github.com/Sunstead/Cosmos/actions/workflows/app-release.yml');
} else {
  console.log('Nothing pushed. When ready:');
  console.log(`  git push origin main && git push origin ${tag}`);
  console.log('To undo instead:');
  console.log(`  git tag -d ${tag} && git reset --hard HEAD~1`);
}
