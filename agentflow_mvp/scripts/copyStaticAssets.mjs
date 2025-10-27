import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const ensureDir = dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const copyRecursive = (source, destination) => {
  if (!fs.existsSync(source)) {
    return;
  }

  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    ensureDir(destination);
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }

  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
};

const cleanDir = dir => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

ensureDir(distDir);

const STATIC_DIRECTORIES = ['public', 'plans'];

for (const relative of STATIC_DIRECTORIES) {
  const sourceDir = path.join(projectRoot, relative);
  const targetDir = path.join(distDir, relative);
  cleanDir(targetDir);
  copyRecursive(sourceDir, targetDir);
}
