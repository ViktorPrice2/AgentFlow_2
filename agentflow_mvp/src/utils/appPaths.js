import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_HINT = process.env.AGENTFLOW_ROOT;
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const execRoot = process.pkg ? path.dirname(process.execPath) : process.cwd();
const baseRoot = ROOT_HINT ? path.resolve(ROOT_HINT) : execRoot;

const candidateRoots = (() => {
  const roots = new Set();
  roots.add(baseRoot);
  roots.add(execRoot);
  roots.add(moduleRoot);
  return Array.from(roots);
})();

export const APP_ROOT = baseRoot;

export const resolveAppPath = (...segments) => {
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
