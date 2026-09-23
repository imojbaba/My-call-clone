import { createServer } from 'vite';
import { parseArgs, project, requireFile } from './lib.mjs';
import path from 'node:path';

// Serves projects/<project>/site/ locally.
const { slug, flags } = parseArgs();
const p = project(slug);
requireFile(path.join(p.site, 'index.html'), `Run: npm run build -- ${slug}`);
const server = await createServer({ root: p.site, configFile: false, server: { port: Number(flags.port) || 5173, host: flags.host ? true : undefined } });
await server.listen();
server.printUrls();
