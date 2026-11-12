// Put a finished build where the site is served from.
//
// GitHub Pages publishes this repository's top folder as it stands, so the app that is live is
// whatever index.html and assets/ sit there. The build itself goes to ../v2 (so that previewing it
// never serves the whole repository folder); this copies that build up one level.
//
// Only the app's own files are touched: index.html, assets/, and what public/ ships. The old
// assets/ is removed first, because every build names its files afresh and stale ones would pile up.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const next = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(next), built = join(root, 'v2');

if (!existsSync(join(built, 'index.html'))) {
  console.error('No build found in v2/. Run "npm run build" first.');
  process.exit(1);
}
rmSync(join(root, 'assets'), { recursive: true, force: true });
for (const name of readdirSync(built)) cpSync(join(built, name), join(root, name), { recursive: true });
console.log(`Released: ${readdirSync(built).join(', ')}`);
