import fs from 'node:fs/promises';
import path from 'node:path';
const src = path.join(process.cwd(), 'data');
const dest = path.join(process.cwd(), 'public', 'data');
await fs.rm(dest, { recursive: true, force: true });
await fs.mkdir(path.dirname(dest), { recursive: true });
await fs.cp(src, dest, { recursive: true });
console.log('Copied data/ to public/data/ for static hosting.');
