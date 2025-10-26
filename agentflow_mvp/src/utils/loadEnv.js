import fs from 'fs';
import dotenv from 'dotenv';
import { resolveAppPath } from './appPaths.js';

const envPath = resolveAppPath('.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
