import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Everything the app stores lives under one folder (override with DATA_DIR, e.g. for tests).
export const root = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, '../data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
export const dataPath = (...p) => path.join(DATA, ...p);
