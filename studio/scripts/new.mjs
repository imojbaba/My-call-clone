import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, fail, parseArgs, project } from './lib.mjs';

// Step 1: create projects/<name>/brief.md for the inspiration and requirements.
const { slug } = parseArgs();
const p = project(slug);
if (existsSync(p.brief)) fail(`${path.relative(ROOT, p.brief)} already exists`);
await mkdir(p.dir, { recursive: true });
const template = await readFile(path.join(ROOT, 'templates', 'brief.md'), 'utf8');
await writeFile(p.brief, template.replaceAll('PROJECT', slug));
console.log(`Created ${path.relative(ROOT, p.brief)}. Fill it in, then run: npm run plan -- ${slug}`);
