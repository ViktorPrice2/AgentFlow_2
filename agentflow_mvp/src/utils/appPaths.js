import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_HINT = process.env.AGENTFLOW_ROOT;

let moduleDir = null;
try {
  const currentFile = fileURLToPath(import.meta.url);
  moduleDir = path.dirname(currentFile);
} catch (error) {
  moduleDir = null;
}

const MODULE_ROOT = moduleDir ? path.resolve(moduleDir, '..', '..') : null;
const DEFAULT_ROOT = MODULE_ROOT || path.resolve(process.cwd());

const EXEC_ROOT = process.pkg
  ? path.dirname(process.execPath)
  : ROOT_HINT
    ? path.resolve(ROOT_HINT)
    : DEFAULT_ROOT;

const SNAPSHOT_ROOT =
  process.pkg && process.pkg.entrypoint
    ? path.dirname(process.pkg.defaultEntrypoint || process.pkg.entrypoint)
    : MODULE_ROOT || EXEC_ROOT;

const addCandidate = (list, candidate) => {
  if (!candidate) return list;
  const resolved = path.resolve(candidate);
  if (!list.some(item => item === resolved)) {
    list.push(resolved);
  }
  return list;
};

const pickWritableRoot = () => {
  const explicit = process.env.AGENTFLOW_DATA_DIR;
  if (explicit) {
    const resolved = path.resolve(explicit);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  if (process.pkg) {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA;
    if (base) {
      const candidate = path.join(base, 'AgentFlow');
      try {
        fs.mkdirSync(candidate, { recursive: true });
        return candidate;
      } catch (error) {
        console.warn(`[AgentFlow] Не удалось создать каталог данных ${candidate}: ${error.message}`);
      }
    }
  }

  return EXEC_ROOT;
};

const DATA_ROOT = pickWritableRoot();

const buildAssetRoots = () => {
  const roots = [];
  addCandidate(roots, EXEC_ROOT);
  addCandidate(roots, SNAPSHOT_ROOT);
  addCandidate(roots, ROOT_HINT);
  addCandidate(roots, MODULE_ROOT);
  if (!process.pkg) {
    addCandidate(roots, process.cwd());
  }
  return roots;
};

const ASSET_ROOTS = buildAssetRoots();
const DEBUG_PATHS = process.env.AGENTFLOW_DEBUG_PATHS === '1';

function resolveFromAssetRoots(segments) {
  for (const root of ASSET_ROOTS) {
    const candidate = path.join(root, ...segments);
    const exists = fs.existsSync(candidate);
    if (DEBUG_PATHS) {
      console.log('[AgentFlow][Paths][probe]', candidate, exists);
    }
    if (exists) {
      return candidate;
    }
  }
  return path.join(EXEC_ROOT, ...segments);
}

export const APP_ROOT = EXEC_ROOT;
export const DATA_DIR = DATA_ROOT;
export const resolveAssetPath = (...segments) => resolveFromAssetRoots(segments);
export const resolveAppPath = (...segments) => resolveAssetPath(...segments);
export const resolveDataPath = (...segments) => path.join(DATA_ROOT, ...segments);

if (DEBUG_PATHS) {
  console.log(
    '[AgentFlow][Paths]',
    JSON.stringify(
      {
        execRoot: EXEC_ROOT,
        snapshotRoot: SNAPSHOT_ROOT,
        dataRoot: DATA_ROOT,
        candidates: ASSET_ROOTS,
      },
      null,
      2
    )
  );
  if (process.pkg) {
    const { entrypoint, defaultEntrypoint, mountpoint } = process.pkg;
    console.log(
      '[AgentFlow][Paths][pkg]',
      JSON.stringify({ entrypoint, defaultEntrypoint, mountpoint }, null, 2)
    );
  }
  if (SNAPSHOT_ROOT) {
    try {
      const snapshotListing = fs.readdirSync(SNAPSHOT_ROOT);
      console.log('[AgentFlow][Paths][snapshot]', SNAPSHOT_ROOT, snapshotListing);
    } catch (error) {
      console.log('[AgentFlow][Paths][snapshot]', SNAPSHOT_ROOT, 'unavailable:', error.message);
    }
    try {
      const parentDir = path.dirname(SNAPSHOT_ROOT);
      const rootListing = fs.readdirSync(parentDir);
      console.log('[AgentFlow][Paths][snapshot-root]', parentDir, rootListing);
    } catch (error) {
      console.log('[AgentFlow][Paths][snapshot-root]', path.dirname(SNAPSHOT_ROOT), 'unavailable:', error.message);
    }
  }
}
