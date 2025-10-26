import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const entryPoint = path.join(projectRoot, 'src', 'server.mjs');
const outfile = path.join(projectRoot, 'dist', 'server.cjs');

await build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile,
});

let contents = await readFile(outfile, 'utf8');

const helperMarker = 'var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\n\n';
if (!contents.includes(helperMarker)) {
  throw new Error('Failed to locate helper marker when injecting view engine shim.');
}

const shim = `function loadViewEngine(mod) {\n  switch (mod) {\n    case "ejs":\n      return require("ejs");\n    case "pug":\n      return require("pug");\n    default:\n      return null;\n  }\n}\n\n`;

if (!contents.includes('function loadViewEngine(')) {
  contents = contents.replace(helperMarker, helperMarker + shim);
}

const dynamicRequireSnippet = 'var fn = require(mod).__express;';
const replacementSnippet = 'var engineModule = loadViewEngine(mod);\n        var fn = engineModule && engineModule.__express;';

if (!contents.includes(dynamicRequireSnippet)) {
  throw new Error('Failed to locate dynamic view engine require snippet.');
}

contents = contents.replace(dynamicRequireSnippet, replacementSnippet);

await writeFile(outfile, contents);

