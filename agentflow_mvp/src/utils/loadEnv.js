import fs from 'fs';
import dotenv from 'dotenv';
import { resolveAssetPath } from './appPaths.js';

const envPath = resolveAssetPath('.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
