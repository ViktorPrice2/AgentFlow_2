import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_PKG = process.pkg;

const resetEnv = () => {
  Object.keys(process.env).forEach(key => {
    delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
};

const loadModule = async () => {
  const module = await import('../src/utils/appPaths.js');
  return module;
};

describe('appPaths snapshot handling', () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();
    resetEnv();
    process.pkg = undefined;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-paths-'));
  });

  afterEach(() => {
    resetEnv();
    process.pkg = ORIGINAL_PKG;
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('joins snapshot paths using POSIX semantics', async () => {
    const mountpoint = path.join(tempDir, 'mount');
    const publicDir = path.join(mountpoint, 'dist', 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    const indexPath = path.join(publicDir, 'index.html');
    fs.writeFileSync(indexPath, '<html></html>');

    process.pkg = {
      entrypoint: 'snapshot:/dist/server.cjs',
      defaultEntrypoint: 'snapshot:/dist/server.cjs',
      mountpoint,
    };

    const { resolveAssetPath, __testables } = await loadModule();
    const { joinWithRoot } = __testables;

    const candidates = joinWithRoot('snapshot:/dist', ['public', 'index.html']);
    expect(candidates).toContain(indexPath);
    expect(candidates).toContain('snapshot:/dist/public/index.html');

    const resolved = resolveAssetPath('public', 'index.html');
    expect(resolved).toBe(indexPath);
  });

  test('falls back to exec root when asset is missing', async () => {
    const mountpoint = path.join(tempDir, 'mount');
    fs.mkdirSync(mountpoint, { recursive: true });

    process.pkg = {
      entrypoint: 'snapshot:/dist/server.cjs',
      defaultEntrypoint: 'snapshot:/dist/server.cjs',
      mountpoint,
    };

    const { resolveAssetPath, APP_ROOT } = await loadModule();
    const resolved = resolveAssetPath('missing.txt');
    expect(resolved.startsWith(APP_ROOT)).toBe(true);
  });
});
