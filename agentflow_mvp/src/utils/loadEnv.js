import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { APP_ROOT, PACKAGE_ROOT } from './appPaths.js';

const envCandidates = [path.join(APP_ROOT, '.env')];
if (PACKAGE_ROOT) {
  envCandidates.push(path.join(PACKAGE_ROOT, '.env'));
}

const envPath = envCandidates.find(candidate => fs.existsSync(candidate));

if (envPath) {
  dotenv.config({ path: envPath });
}
