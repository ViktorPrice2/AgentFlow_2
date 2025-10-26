import path from 'path';

const ROOT_HINT = process.env.AGENTFLOW_ROOT;
const appRoot = process.pkg
  ? path.dirname(process.execPath)
  : ROOT_HINT
    ? path.resolve(ROOT_HINT)
    : process.cwd();

export const APP_ROOT = appRoot;

export const resolveAppPath = (...segments) => path.join(appRoot, ...segments);
