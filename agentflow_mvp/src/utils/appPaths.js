import fs from 'fs';
import path from 'path';

const ROOT_HINT = process.env.AGENTFLOW_ROOT;

const moduleRoot = (() => {
  if (process.pkg && process.pkg.entrypoint) {
    return path.resolve(path.dirname(process.pkg.entrypoint), '..', '..');
  }

  const entryPath = Array.isArray(process.argv) ? process.argv[1] : undefined;
  if (entryPath) {
    return path.resolve(path.dirname(entryPath), '..');
  }

  if (typeof __dirname === 'string') {
    return path.resolve(__dirname, '..', '..');
  }

  return undefined;
})();

const execRoot = process.pkg ? path.dirname(process.execPath) : process.cwd();
const defaultRoot = !process.pkg && moduleRoot ? moduleRoot : execRoot;
const baseRoot = ROOT_HINT ? path.resolve(ROOT_HINT) : defaultRoot;

const candidateRoots = (() => {
  const roots = new Set();
  roots.add(baseRoot);
  roots.add(execRoot);
  if (moduleRoot) {
    roots.add(moduleRoot);
  }
  return Array.from(roots);
})();

export const APP_ROOT = baseRoot;
export const PACKAGE_ROOT = moduleRoot;

const resolveFromCandidates = segments => {
  if (segments.length === 0) {
    return baseRoot;
  }

  for (const root of candidateRoots) {
    if (!root) {
      continue;
    }

    const candidate = path.join(root, ...segments);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(baseRoot, ...segments);
};

export const resolveAssetPath = (...segments) => resolveFromCandidates(segments);

export const resolveWritablePath = (...segments) => path.join(baseRoot, ...segments);

export const resolveAppPath = (...segments) => resolveAssetPath(...segments);
