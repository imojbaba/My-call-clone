import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fal } from '@fal-ai/client';
import { checkPlan, dependencyOrder, fail, ffmpeg, fileInfo, loadModels, log, parseArgs, project, readJson, requireFile, writeJson } from './lib.mjs';

// Step 3: generate every asset in plan.json, one at a time, in dependency order.
//   npm run generate -- <project>              show the cost estimate, then stop
//   npm run generate -- <project> --yes        generate everything not yet done
//   npm run generate -- <project> --yes --only hero-video   (re)generate one asset
//   npm run generate -- <project> --mock       offline placeholders, no keys needed
// Results go to projects/<project>/assets/ and are recorded in manifest.json,
// so a failed or interrupted run resumes where it stopped.
const { slug, flags } = parseArgs();
const p = project(slug);
requireFile(p.plan, `Run: npm run plan -- ${slug}`);
const plan = await readJson(p.plan);
const models = await loadModels();
const problems = checkPlan(plan, models);
if (problems.length) fail(`plan.json has problems:\n  - ${problems.join('\n  - ')}`);

const manifest = await readJson(p.manifest, { assets: {} });
const ordered = dependencyOrder(plan.assets);
// An asset is redone when it is missing, or when an input it was made from is
// being redone or is newer than it (e.g. the keyframe was regenerated).
const todo = [];
for (const asset of ordered) {
  const record = manifest.assets[asset.id];
  const stale = asset.depends_on.some(dep => todo.some(item => item.id === dep) || manifest.assets[dep]?.generated_at > record?.generated_at);
  if (flags.only ? asset.id === flags.only : flags.force || record?.status !== 'done' || stale) todo.push(asset);
}
if (flags.only && !todo.length) fail(`No asset with id "${flags.only}" in plan.json`);
if (!todo.length) { log('Every asset is already generated. Use --only <id> or --force to redo.'); process.exit(0); }

const estimate = todo.reduce((sum, asset) => {
  const { price } = models.tools[asset.tool];
  return sum + price.usd * (price.per === 'second' ? pickDuration(models.tools[asset.tool], asset.duration_seconds).seconds : 1);
}, 0);
log(`${todo.length} asset(s) to generate: ${todo.map(asset => asset.id).join(', ')}`);
if (!flags.mock) {
  log(`Estimated cost on fal.ai: about $${estimate.toFixed(2)} (prices in config/models.json; check fal.ai for current rates)`);
  if (!flags.yes) { console.log('\nNothing generated yet. Run again with --yes to spend it.'); process.exit(0); }
  if (!process.env.FAL_KEY) fail('FAL_KEY is not set. See README.md, "API keys".');
  fal.config({ credentials: process.env.FAL_KEY });
}

await mkdir(p.assets, { recursive: true });
for (const asset of todo) {
  const tool = models.tools[asset.tool];
  const started = Date.now();
  log(`Generating ${asset.id} with ${asset.tool}...`);
  try {
    const inputs = await Promise.all(asset.depends_on.map(dep => {
      const record = manifest.assets[dep];
      if (record?.status !== 'done') throw new Error(`${asset.id} needs "${dep}", which has not been generated`);
      return path.join(p.dir, record.file);
    }));
    const record = flags.mock ? await mockAsset(asset, tool, inputs) : await falAsset(asset, tool, inputs);
    manifest.assets[asset.id] = {
      status: 'done', ...record, ...(await fileInfo(path.join(p.dir, record.file))),
      prompt: asset.prompt, generated_at: new Date().toISOString(), seconds_taken: Math.round((Date.now() - started) / 1000),
    };
    log(`  saved ${record.file}`);
  } catch (error) {
    manifest.assets[asset.id] = { status: 'failed', tool: asset.tool, error: String(error.message || error), failed_at: new Date().toISOString() };
    await writeJson(p.manifest, manifest);
    fail(`${asset.id} failed: ${error.message || error}\nFix the cause (or edit its prompt in plan.json) and run the same command again; finished assets are kept.`);
  }
  await writeJson(p.manifest, manifest);
}
log(`Done. Next: npm run finish -- ${slug}`);

async function falAsset(asset, tool, inputs) {
  const uploads = [];
  for (const file of inputs) {
    const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    uploads.push(await fal.storage.upload(new Blob([await readFile(file)], { type })));
  }
  const duration = tool.durations ? pickDuration(tool, asset.duration_seconds) : null;
  const values = {
    prompt: asset.prompt,
    negative_prompt: asset.negative_prompt || undefined,
    image_0: uploads[0],
    image_1: uploads[1],
    aspect_ratio: asset.aspect_ratio,
    size: tool.aspect?.[asset.aspect_ratio],
    duration: duration?.value,
  };
  const input = fillTemplate(tool.input, values);
  let lastStatus = '';
  const result = await fal.subscribe(tool.endpoint, {
    input,
    logs: true,
    onQueueUpdate(update) {
      if (update.status !== lastStatus) { lastStatus = update.status; log(`  ${update.status.toLowerCase().replace('_', ' ')}`); }
    },
  });
  const url = tool.output.split('.').reduce((value, key) => value?.[key], result.data);
  if (typeof url !== 'string') throw new Error(`No output at "${tool.output}" in the response: ${JSON.stringify(result.data).slice(0, 400)}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const ext = tool.kind === 'video' ? 'mp4' : (path.extname(new URL(url).pathname).slice(1) || 'jpg');
  const file = path.join('assets', `${asset.id}.${ext}`);
  await writeFile(path.join(p.dir, file), Buffer.from(await response.arrayBuffer()));
  return { tool: asset.tool, endpoint: tool.endpoint, request_id: result.requestId, source_url: url, input: { ...input, ...redactUploads(input) }, file };
}

// Replaces "{name}" strings (also inside arrays and objects) and drops keys whose value is missing.
function fillTemplate(template, values) {
  if (Array.isArray(template)) return template.map(item => fillTemplate(item, values)).filter(item => item !== undefined);
  if (template && typeof template === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(template)) {
      const filled = fillTemplate(value, values);
      if (filled !== undefined && !(Array.isArray(filled) && !filled.length)) out[key] = filled;
    }
    return out;
  }
  const match = typeof template === 'string' && /^\{(\w+)\}$/.exec(template);
  return match ? values[match[1]] : template;
}

function redactUploads(input) {
  // Upload URLs expire; keep the manifest readable by noting which inputs were local files.
  const out = {};
  for (const [key, value] of Object.entries(input)) if (typeof value === 'string' && value.includes('fal.media')) out[key] = '(uploaded input frame)';
  return out;
}

function pickDuration(tool, wanted) {
  const options = (tool.durations || [wanted || 1]).map(value => ({ value, seconds: parseFloat(value) }));
  return options.reduce((best, option) => (Math.abs(option.seconds - wanted) < Math.abs(best.seconds - wanted) ? option : best));
}

// Placeholder media made locally with ffmpeg, shaped like the real outputs.
async function mockAsset(asset, tool, inputs) {
  const [w, h] = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1440, 1440] }[asset.aspect_ratio];
  if (tool.kind === 'video') {
    const file = path.join('assets', `${asset.id}.mp4`);
    const seconds = pickDuration(tool, asset.duration_seconds).seconds;
    await ffmpeg([
      '-loop', '1', '-i', inputs[0], '-t', String(seconds),
      '-vf', `scale=${w * 2}:-2,zoompan=z='1+0.08*on/(${seconds}*24)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=24,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', path.join(p.dir, file),
    ]);
    return { tool: asset.tool, endpoint: 'mock', file };
  }
  const file = path.join('assets', `${asset.id}.jpg`);
  const source = inputs[0]
    ? ['-i', inputs[0], '-vf', `scale=${w}:${h},hue=h=12:b=0.3`]
    : ['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=0x3d4a49:c1=0xc9a36b:c2=0x1d2a2b:x0=0:y0=0:x1=${w}:y1=${h}:n=3`];
  await ffmpeg([...source, '-frames:v', '1', '-q:v', '3', path.join(p.dir, file)]);
  return { tool: asset.tool, endpoint: 'mock', file };
}
