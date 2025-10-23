import fs from 'fs';
import path from 'path';

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

export function loadEnv(envPath = '.env') {
  if (loaded) return;
  const fullPath = path.resolve(process.cwd(), envPath);
  if (!fs.existsSync(fullPath)) {
    loaded = true;
    return;
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const parsed = parseLine(line);
    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
  loaded = true;
}
