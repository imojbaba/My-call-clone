import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { PlanSchema, ROOT, checkPlan, fail, loadModels, log, parseArgs, project, readJson, requireFile, writeJson } from './lib.mjs';

// Step 2: brief.md -> plan.json (copy, palette, logo, change list, asset list with prompts).
//   npm run plan -- <project>                       first plan
//   npm run plan -- <project> --revise "warmer, no people"   revise the existing plan
//   npm run plan -- <project> --mock                offline plan for testing the pipeline
const { slug, flags } = parseArgs();
const p = project(slug);
requireFile(p.brief, `Run: npm run new -- ${slug}`);

const models = await loadModels();
const brief = await readFile(p.brief, 'utf8');
const baseline = await readJson(path.join(ROOT, 'templates', 'hero-loop', 'baseline.json'));

let plan;
if (flags.mock) plan = mockPlan();
else plan = await askClaude();

const problems = checkPlan(plan, models);
await writeJson(p.plan, plan);
log(`Wrote ${path.relative(ROOT, p.plan)}: ${plan.changes.length} changes, ${plan.assets.length} assets`);
for (const asset of plan.assets) log(`  ${asset.id} (${asset.role}) via ${asset.tool}${asset.depends_on.length ? ` from ${asset.depends_on.join(' + ')}` : ''}`);
if (problems.length) {
  console.warn('\nThe plan needs attention before generating:\n' + problems.map(problem => `  - ${problem}`).join('\n'));
  console.warn(`Edit plan.json by hand or run: npm run plan -- ${slug} --revise "fix: ${problems[0]}"`);
  process.exit(1);
}
console.log(`\nNext: review plan.json, then run: npm run generate -- ${slug}`);

async function askClaude() {
  const client = new Anthropic();
  const toolList = Object.entries(models.tools)
    .map(([key, tool]) => `- ${key} (${tool.kind}): ${tool.label}${tool.durations ? `; durations ${tool.durations.join(', ')}` : ''}; about $${tool.price.usd}/${tool.price.per}`)
    .join('\n');
  const defaults = Object.entries(models.defaults).map(([role, tool]) => `${role} -> ${tool}`).join(', ');

  const system = `You are the creative director and prompt writer for a one-screen hero website.

The page template is fixed: a full-screen muted background video loop, a slim nav (wordmark with a 32x32 SVG logo, 4 links, a contact link), a two-line headline (light sans line, then italic serif line), a short subheading, one button, a quiet footer line, and 24 short italic phrases that drift in and out over the video on the left and right. Fonts are DM Sans and Instrument Serif. Text colour sits directly on the video, so the scene needs calm, darker or evenly lit areas around the centre and lower third.

Your job: turn the brief into plan.json - new copy, palette, logo, a change list against the current template, and the list of assets to generate, with production-ready prompts.

Asset rules:
- One keyframe still (role keyframe) that is the first frame of the film, 16:9, photoreal and cinematic unless the brief says otherwise. Describe lens, light, time of day, colour palette, composition and where the calm negative space is. No text, logos or watermarks in frame.
- Optionally an end_frame still made by editing the keyframe (depends_on: [keyframe]) when the motion needs a defined destination, e.g. the light has shifted or the camera has moved slightly. Keep it nearly identical so a loop stays seamless.
- Exactly one hero_video made from the keyframe (and end frame if any), 8-12 seconds. Describe one slow, continuous camera movement and gentle ambient motion. For loop method "pingpong" (the film plays forwards then backwards), choose motion without an obvious direction: slow drift, breathing light, mist, water shimmer; avoid walking people, falling objects, smoke rising, wind gusts. Use "crossfade" for motion that naturally repeats. Keep hands and faces small or soft-focused; every current video model still distorts them.
- negative_prompt lists what must not appear (text, watermark, extra fingers, flicker, fast cuts, camera shake).
- Pick tools from this list and prefer the defaults (${defaults}) unless the brief asks otherwise:
${toolList}

Copy rules: original words only, never quoted lyrics or slogans. Phrases are 3-7 words, lowercase, no end punctuation, 24 of them, all different, and in the voice of the brand. The palette: background is sampled from the scene's dominant dark tone, ink is a warm light tone readable over the video, shade is a deep tone for text shadows.

The change list names every area that differs from the current template (copy, palette, logo, background film, loop method), with from, to and why.`;

  const previous = existsSync(p.plan) ? await readJson(p.plan) : null;
  const content = [
    `Current template values (the "from" side of the change list):\n${JSON.stringify(baseline, null, 2)}`,
    `Brief:\n${brief}`,
  ];
  if (flags.revise) {
    if (!previous) fail('There is no plan.json to revise yet. Run the plan step without --revise first.');
    content.push(`Current plan:\n${JSON.stringify(previous, null, 2)}`, `Revise the current plan with this feedback, keeping everything else unchanged:\n${flags.revise}`);
  }

  log(`Asking ${process.env.PLANNER_MODEL || 'claude-opus-5'} for a plan...`);
  let response;
  try {
    response = await client.beta.messages.parse({
      model: process.env.PLANNER_MODEL || 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(PlanSchema) },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: content.join('\n\n---\n\n') }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) fail('ANTHROPIC_API_KEY is missing or invalid. See README.md, "API keys".');
    if (error instanceof Anthropic.RateLimitError) fail('Rate limited by the Claude API. Wait a minute and run the step again.');
    if (error instanceof Anthropic.APIConnectionError) fail('Could not reach api.anthropic.com. Check the network settings.');
    if (error instanceof Anthropic.APIError) fail(`Claude API error ${error.status}: ${error.message}`);
    // The SDK throws a plain Error before any request when it finds no credentials.
    fail(`Could not call Claude: ${error.message}\nIs ANTHROPIC_API_KEY set? See README.md, "API keys".`);
  }
  if (response.stop_reason === 'refusal') fail(`The planner declined: ${response.stop_details?.explanation ?? 'no reason given'}. Rephrase the brief.`);
  if (response.stop_reason === 'max_tokens') fail('The plan was cut off at max_tokens. Shorten the brief and try again.');
  if (!response.parsed_output) fail('The planner returned no parseable plan. Run the step again.');
  log(`Planner used ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens`);
  return response.parsed_output;
}

// Offline plan: the template's own copy plus placeholder asset prompts built from
// the brief, so every later step can be exercised without API keys.
function mockPlan() {
  const subject = /## Subject of the background film\n(?:<!--.*?-->\n)?([^\n#]+)/s.exec(brief)?.[1]?.trim() || 'a quiet landscape at golden hour';
  return {
    ...baseline,
    concept: `Mock plan for testing. Subject: ${subject}.`,
    changes: [{ area: 'background film', from: 'pianist in a meadow', to: subject, why: 'mock run' }],
    assets: [
      {
        id: 'keyframe', role: 'keyframe', tool: models.defaults.keyframe,
        prompt: `Cinematic photoreal still, 35mm, soft natural light: ${subject}. Calm negative space in the centre. No text.`,
        negative_prompt: 'text, watermark, logo', depends_on: [], aspect_ratio: '16:9', duration_seconds: 0,
        notes: 'Check the centre is calm enough for white text.',
      },
      {
        id: 'hero-video', role: 'hero_video', tool: models.defaults.hero_video,
        prompt: `Slow continuous push-in, gentle ambient motion: ${subject}.`,
        negative_prompt: 'text, watermark, flicker, fast cuts, camera shake', depends_on: ['keyframe'], aspect_ratio: '16:9', duration_seconds: 10,
        notes: 'Check for flicker and that the motion reads well played backwards.',
      },
    ],
  };
}
