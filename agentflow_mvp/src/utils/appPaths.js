import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_HINT = process.env.AGENTFLOW_ROOT;
const SNAPSHOT_PREFIX = 'snapshot:';

const isSnapshotPath = value => typeof value === 'string' && value.startsWith(SNAPSHOT_PREFIX);

const normalizeSnapshotValue = value => {
  if (!value) {
    return null;
  }

  const raw = value.replace(/\\/g, '/');
  const withoutPrefix = raw.startsWith(SNAPSHOT_PREFIX) ? raw.slice(SNAPSHOT_PREFIX.length) : raw;
  const trimmed = withoutPrefix.startsWith('/') ? withoutPrefix : `/${withoutPrefix}`;
  return `${SNAPSHOT_PREFIX}${trimmed}`;
};

const toAbsoluteIfPossible = candidate => {
  if (!candidate) {
    return null;
  }

  if (isSnapshotPath(candidate)) {
    return normalizeSnapshotValue(candidate);
  }

  return path.resolve(candidate);
};

const deriveSnapshotRoot = () => {
  if (!process.pkg) {
    return null;
  }

  const entry = process.pkg.defaultEntrypoint || process.pkg.entrypoint;
  if (!entry) {
    return null;
  }

  if (isSnapshotPath(entry) || entry.startsWith('/snapshot')) {
    return path.posix.dirname(normalizeSnapshotValue(entry));
  }

  if (entry.startsWith('file://')) {
    return normalizeSnapshotValue(fileURLToPath(entry));
  }

  return path.dirname(entry);
};

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

const SNAPSHOT_ROOT = deriveSnapshotRoot() || MODULE_ROOT || EXEC_ROOT;

const expandSnapshotCandidate = candidate => {
  if (!candidate || !isSnapshotPath(candidate)) {
    return [candidate].filter(Boolean);
  }

  const normalized = normalizeSnapshotValue(candidate);
  const results = [normalized];

  const mountpoint = process.pkg?.mountpoint;
  if (mountpoint) {
    const resolvedMount = path.resolve(mountpoint);
    const relative = normalized.slice(SNAPSHOT_PREFIX.length).replace(/^\/+/, '');
    const expanded = path.join(resolvedMount, relative);
    if (!results.includes(expanded)) {
      results.unshift(expanded);
    }
  }

  return results;
};

const joinWithRoot = (root, segments) => {
  if (!root) {
    return [];
  }

  const normalizedRoot = toAbsoluteIfPossible(root);
  if (!normalizedRoot) {
    return [];
  }

  if (isSnapshotPath(normalizedRoot)) {
    const joined = segments.reduce(
      (acc, segment) => path.posix.join(acc, segment),
      normalizedRoot
    );
    return expandSnapshotCandidate(joined);
  }

  const joined = path.join(normalizedRoot, ...segments);
  return [joined];
};

const addCandidate = (list, candidate) => {
  const normalized = toAbsoluteIfPossible(candidate);
  if (!normalized) {
    return list;
  }

  if (!list.includes(normalized)) {
    list.push(normalized);
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
  if (process.pkg?.mountpoint) {
    addCandidate(roots, process.pkg.mountpoint);
  }
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
    const candidates = joinWithRoot(root, segments);
    for (const candidate of candidates) {
      let exists = false;
      try {
        exists = fs.existsSync(candidate);
      } catch (error) {
        exists = false;
        if (DEBUG_PATHS) {
          console.log('[AgentFlow][Paths][probe-error]', candidate, error.message);
        }
      }

      if (DEBUG_PATHS) {
        console.log('[AgentFlow][Paths][probe]', candidate, exists);
      }

      if (exists) {
        return candidate;
      }
    }
  }
  const fallbackCandidates = joinWithRoot(EXEC_ROOT, segments);
  return fallbackCandidates[0] || path.join(EXEC_ROOT, ...segments);
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

export const __testables = {
  SNAPSHOT_PREFIX,
  isSnapshotPath,
  normalizeSnapshotValue,
  joinWithRoot,
};
