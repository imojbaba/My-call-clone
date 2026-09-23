import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { z } from 'zod';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Local runs read keys from studio/.env; cloud sessions get them from the environment.
if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const run = promisify(execFile);

/** Parses `<slug> --flag --key value` into { slug, flags }. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
  }
  return { slug: positional[0], rest: positional.slice(1), flags };
}

export function project(slug) {
  if (!slug) fail('Name a project: npm run <step> -- <project-name>');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`Project names use lowercase letters, digits and dashes: "${slug}"`);
  const dir = path.join(ROOT, 'projects', slug);
  return {
    slug,
    dir,
    brief: path.join(dir, 'brief.md'),
    plan: path.join(dir, 'plan.json'),
    manifest: path.join(dir, 'manifest.json'),
    assets: path.join(dir, 'assets'),
    work: path.join(dir, 'work'),
    site: path.join(dir, 'site'),
    review: path.join(dir, 'review.html'),
  };
}

export function requireFile(file, hint) {
  if (!existsSync(file)) fail(`${path.relative(ROOT, file)} is missing. ${hint}`);
}

export async function readJson(file, fallback) {
  if (fallback !== undefined && !existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export async function fileInfo(file) {
  const data = await readFile(file);
  return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}

export async function ffmpeg(args) {
  try {
    const { stderr } = await run(ffmpegPath, ['-hide_banner', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stderr;
  } catch (error) {
    throw new Error(`ffmpeg failed: ffmpeg ${args.join(' ')}\n${String(error.stderr || error.message).split('\n').slice(-12).join('\n')}`);
  }
}

/** Duration in seconds, read from ffmpeg's input banner (ffmpeg-static ships without ffprobe). */
export async function mediaDuration(file) {
  const stderr = await run(ffmpegPath, ['-hide_banner', '-i', file]).catch(error => ({ stderr: error.stderr }));
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr.stderr || '');
  if (!match) throw new Error(`Could not read the duration of ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export async function loadModels() {
  return readJson(path.join(ROOT, 'config', 'models.json'));
}

/** Orders assets so every dependency is generated before the assets that use it. */
export function dependencyOrder(assets) {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const ordered = [];
  const state = new Map();
  const visit = (asset, trail) => {
    if (state.get(asset.id) === 'done') return;
    if (state.get(asset.id) === 'visiting') fail(`Assets depend on each other in a circle: ${[...trail, asset.id].join(' -> ')}`);
    state.set(asset.id, 'visiting');
    for (const dep of asset.depends_on) {
      if (!byId.has(dep)) fail(`Asset "${asset.id}" depends on unknown asset "${dep}"`);
      visit(byId.get(dep), [...trail, asset.id]);
    }
    state.set(asset.id, 'done');
    ordered.push(asset);
  };
  for (const asset of assets) visit(asset, []);
  return ordered;
}

export function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

export const log = (...parts) => console.log('•', ...parts);

// Shape of plan.json. The planning step asks Claude for exactly this; build.mjs
// and generate.mjs read it back. Counts (24 phrases, 4 nav links) are checked in
// checkPlan because structured outputs do not enforce array lengths.
export const PlanSchema = z.object({
  concept: z.string().describe('One paragraph: the idea, subject, mood and why it fits the brief.'),
  site: z.object({
    brand_name: z.string().describe('Brand name as written in prose, e.g. "Soft Hours".'),
    wordmark: z.string().describe('Brand as shown in the nav wordmark, e.g. "soft hours".'),
    title: z.string().describe('Browser tab title.'),
    description: z.string().describe('Meta description, under 160 characters.'),
    nav_links: z.array(z.string()).describe('Exactly 4 short nav labels.'),
    contact_label: z.string(),
    headline_sans: z.string().describe('First headline line, light sans, 3-5 words.'),
    headline_serif: z.string().describe('Second headline line, italic serif, 3-5 words.'),
    subheading: z.string().describe('One or two short sentences, under 110 characters.'),
    cta: z.string().describe('Button label, 2-4 words.'),
    footer: z.string().describe('Quiet footer line, under 45 characters.'),
    phrases: z.array(z.string()).describe('Exactly 24 original floating phrases, 3-7 words each, lowercase, no end punctuation.'),
  }),
  palette: z.object({
    background: z.string().describe('Hex colour shown before the video loads, sampled from the scene, e.g. "#3d4a49".'),
    ink: z.string().describe('Hex text colour that reads well over the video, e.g. "#f4f1ea".'),
    shade: z.string().describe('Hex dark tone used for soft text shadows and the top tint, e.g. "#141e20".'),
  }),
  logo: z.object({
    idea: z.string(),
    shapes: z.array(z.object({
      d: z.string().describe('SVG path data in a 32x32 viewBox.'),
      style: z.enum(['fill', 'stroke']),
    })),
  }),
  changes: z.array(z.object({
    area: z.string().describe('Part of the page, e.g. "headline", "palette", "background video".'),
    from: z.string(),
    to: z.string(),
    why: z.string(),
  })).describe('Everything that changes relative to the template, one row per change.'),
  assets: z.array(z.object({
    id: z.string().describe('kebab-case id, e.g. "keyframe", "end-frame", "hero-video".'),
    role: z.enum(['keyframe', 'end_frame', 'hero_video', 'extra_image']),
    tool: z.string().describe('A tool key from the tool list.'),
    prompt: z.string(),
    negative_prompt: z.string(),
    depends_on: z.array(z.string()).describe('Asset ids used as inputs, in order: start frame first, then end frame.'),
    aspect_ratio: z.enum(['16:9', '9:16', '1:1']),
    duration_seconds: z.number().describe('Video length; 0 for images.'),
    notes: z.string().describe('What to check when reviewing this asset.'),
  })),
  loop: z.object({
    method: z.enum(['pingpong', 'crossfade', 'none']),
    why: z.string(),
  }),
});

export function checkPlan(plan, models) {
  const problems = [];
  const { site } = plan;
  if (site.phrases.length !== 24) problems.push(`site.phrases has ${site.phrases.length} entries; the page expects 24`);
  if (new Set(site.phrases).size !== site.phrases.length) problems.push('site.phrases contains duplicates');
  if (site.nav_links.length !== 4) problems.push(`site.nav_links has ${site.nav_links.length} entries; the layout expects 4`);
  for (const [key, value] of Object.entries(plan.palette)) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) problems.push(`palette.${key} is not a 6-digit hex colour: ${value}`);
  }
  for (const shape of plan.logo.shapes) {
    if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(shape.d)) problems.push(`logo path contains unexpected characters: ${shape.d}`);
  }
  const ids = new Set();
  for (const asset of plan.assets) {
    if (ids.has(asset.id)) problems.push(`duplicate asset id ${asset.id}`);
    ids.add(asset.id);
    if (!models.tools[asset.tool]) problems.push(`asset ${asset.id} uses unknown tool "${asset.tool}"`);
  }
  if (plan.assets.filter(asset => asset.role === 'hero_video').length !== 1) problems.push('the plan needs exactly one asset with role hero_video');
  return problems;
}
