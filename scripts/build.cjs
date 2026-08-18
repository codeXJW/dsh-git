#!/usr/bin/env node
// Windows-friendly equivalent of build.sh — no bash required.
// Usage: node scripts/build.cjs [--checkout <path>]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// --- Resolve DSH_CHECKOUT ---
let CHECKOUT = process.env.DSH_CHECKOUT || '';
if (!CHECKOUT) {
  const candidates = [
    path.join(process.env.HOME || '', 'dsh-harness'),
    path.join(process.env.HOME || '', 'dsh'),
    path.join(process.env.HOME || '', '.dsh', 'dsh-harness'),
  ];
  const flagIdx = process.argv.indexOf('--checkout');
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    candidates.unshift(process.argv[flagIdx + 1]);
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'packages'))) { CHECKOUT = c; break; }
  }
}
if (!CHECKOUT || !fs.existsSync(path.join(CHECKOUT, 'packages'))) {
  console.error('build: cannot locate the dsh checkout (set DSH_CHECKOUT or pass --checkout)');
  process.exit(1);
}
console.log('=== DSH checkout: ' + CHECKOUT + ' ===');

// --- Find tsc ---
const TSC_CMD = path.join(CHECKOUT, 'node_modules', '.bin', 'tsc.cmd');
const TSC_SH = path.join(CHECKOUT, 'node_modules', '.bin', 'tsc');
const tscBin = fs.existsSync(TSC_CMD) ? TSC_CMD : (fs.existsSync(TSC_SH) ? TSC_SH : '');
if (!tscBin) {
  console.error('build: tsc not found at ' + TSC_CMD);
  process.exit(1);
}

// --- Helper: create junction symlink ---
function linkPkg(pkgName, checkoutRel) {
  const target = path.resolve(CHECKOUT, checkoutRel);
  const link = path.resolve(ROOT, 'node_modules', pkgName);
  if (!fs.existsSync(target)) {
    console.error('build: dependency target missing: ' + target);
    process.exit(1);
  }
  fs.rmSync(link, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'junction');
  console.log('  linked ' + pkgName + ' -> ' + target);
}

// --- Link build dependencies ---
console.log('=== Linking build dependencies ===');
fs.mkdirSync(path.join(ROOT, 'node_modules', '@deepseek-ai'), { recursive: true });

const ssDir = path.join(ROOT, 'node_modules', '@standard-schema');
fs.rmSync(ssDir, { recursive: true, force: true });

linkPkg('cordis', 'vendor/cordis');
linkPkg('cosmokit', 'vendor/cosmokit');
linkPkg('schemastery', 'vendor/schemastery');
linkPkg('@deepseek-ai/dsh-tools', 'packages/core/tools');
linkPkg('@deepseek-ai/dsh-llm', 'packages/llm/llm');
linkPkg('@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt');
linkPkg('@types/node', 'node_modules/@types/node');

// --- Link @standard-schema/spec from pnpm store ---
const pnpmDir = path.join(CHECKOUT, 'node_modules', '.pnpm');
if (fs.existsSync(pnpmDir)) {
  const entries = fs.readdirSync(pnpmDir).filter(function(e) { return /^@standard-schema\+spec@/i.test(e); });
  if (entries.length > 0) {
    const specDir = path.join(pnpmDir, entries[0], 'node_modules', '@standard-schema', 'spec');
    if (fs.existsSync(specDir)) {
      fs.rmSync(ssDir, { recursive: true, force: true });
      fs.mkdirSync(ssDir, { recursive: true });
      fs.symlinkSync(specDir, path.join(ssDir, 'spec'), 'junction');
      console.log('  linked @standard-schema/spec -> ' + specDir);
    }
  }
}

// --- Run tsc ---
console.log('=== Compiling src -> lib ===');
execSync('"' + tscBin + '" -p tsconfig.json', { stdio: 'inherit', cwd: ROOT });
console.log('=== Build complete ===');
