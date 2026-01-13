#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function isExecutable(mode) {
  // Any execute bit set
  return (mode & 0o111) !== 0;
}

function tryChmod(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { changed: false };

    if (isExecutable(stat.mode)) {
      return { changed: false };
    }

    // 755 is typical for helper binaries
    fs.chmodSync(filePath, 0o755);
    return { changed: true };
  } catch (err) {
    return { changed: false, error: err };
  }
}

function main() {
  const projectRoot = process.cwd();
  const prebuildsDir = path.join(projectRoot, 'node_modules', 'node-pty', 'prebuilds');

  if (!fs.existsSync(prebuildsDir)) {
    // node-pty not installed; nothing to do
    process.exit(0);
  }

  const candidates = [];
  for (const entry of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    candidates.push(path.join(prebuildsDir, entry.name, 'spawn-helper'));
  }

  let changedAny = false;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const result = tryChmod(candidate);
    if (result.error) {
      // Non-fatal; print for debugging but don't fail install
      console.warn(`[fix-node-pty-perms] Could not chmod ${candidate}:`, result.error.message);
      continue;
    }
    if (result.changed) {
      changedAny = true;
      console.log(`[fix-node-pty-perms] Marked executable: ${candidate}`);
    }
  }

  if (!changedAny) {
    console.log('[fix-node-pty-perms] No changes needed.');
  }
}

main();
