import fs from 'fs';
import { resolveDataPath } from './appPaths.js';

let loaded = false;

function parseLine(line) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  let [, key, value] = match;
  if (value?.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else if (value?.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export function loadEnv() {
  if (loaded) return;
  const envPath = resolveDataPath('.env');
  if (!fs.existsSync(envPath)) {
    loaded = true;
    return;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const parsed = parseLine(line);
    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
  loaded = true;
}

loadEnv(); // Загружаем переменные при импорте модуля
