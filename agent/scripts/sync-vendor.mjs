import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(rootDir, 'node_modules', 'three', 'build');
const outDir = path.join(rootDir, 'public', 'vendor');

fs.mkdirSync(outDir, { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) {
  const src = path.join(srcDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, file));
  }
}
