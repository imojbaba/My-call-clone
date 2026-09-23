import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, checkPlan, fail, loadModels, log, parseArgs, project, readJson, requireFile, writeJson } from './lib.mjs';

// Step 5: write the finished site to projects/<project>/site/ from the template,
// plan.json and the finished media. The folder is static; host it anywhere.
const { slug } = parseArgs();
const p = project(slug);
requireFile(p.plan, `Run: npm run plan -- ${slug}`);
requireFile(p.manifest, `Run: npm run generate -- ${slug}`);
const plan = await readJson(p.plan);
const manifest = await readJson(p.manifest);
const problems = checkPlan(plan, await loadModels());
if (problems.length) fail(`plan.json has problems:\n  - ${problems.join('\n  - ')}`);
if (!manifest.finished) fail(`The media is not finished yet. Run: npm run finish -- ${slug}`);

const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ');
const { site, palette, logo } = plan;
const media = manifest.finished.files;
const names = { video: 'hero-loop.mp4', mobile: 'hero-loop-720.mp4', poster: 'hero-poster.jpg' };

const values = {
  title: escape(site.title),
  description: escape(site.description),
  bg: palette.background,
  ink: palette.ink,
  bg_url: palette.background.replace('#', '%23'),
  ink_url: palette.ink.replace('#', '%23'),
  ink_rgb: rgb(palette.ink),
  shade_rgb: rgb(palette.shade),
  poster: names.poster,
  // Browsers ignore media="" on <source> inconsistently, so an inline script right
  // after the <video> swaps in the 720p file on narrow screens before much loads.
  video_sources: `      <source src="${names.video}" data-phone-src="${names.mobile}" type="video/mp4">`,
  brand_name: escape(site.brand_name),
  brand: escape(site.wordmark),
  logo_svg: logo.shapes.map(shape => shape.style === 'fill'
    ? `            <path d="${escape(shape.d)}" fill="currentColor"/>`
    : `            <path d="${escape(shape.d)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`).join('\n'),
  nav_links: site.nav_links.map(label => `          <a href="#">${escape(label)}</a>`).join('\n'),
  contact_label: escape(site.contact_label),
  headline_sans: escape(site.headline_sans),
  headline_serif: escape(site.headline_serif),
  subheading: escape(site.subheading),
  cta: escape(site.cta),
  footer: escape(site.footer),
  // Inside a <script>: JSON is valid JS; escape "<" so a phrase can never close the tag.
  phrases_json: JSON.stringify(site.phrases, null, 10).replace(/</g, '\\u003c').replace(/\n\]$/, '\n        ]'),
};

const template = await readFile(path.join(ROOT, 'templates', 'hero-loop', 'index.html'), 'utf8');
const html = template.replace(/\{\{(\w+)\}\}/g, (token, key) => {
  if (!(key in values)) fail(`The template uses {{${key}}}, which build.mjs does not fill`);
  return values[key];
});

await mkdir(p.site, { recursive: true });
await writeFile(path.join(p.site, 'index.html'), html);
const assetList = [];
for (const [key, name] of Object.entries(names)) {
  await copyFile(path.join(p.dir, media[key].file), path.join(p.site, name));
  assetList.push({ file: name, sha256: media[key].sha256, bytes: media[key].bytes });
}
await writeJson(path.join(p.site, 'assets.json'), assetList);
log(`Built ${path.relative(ROOT, p.site)}/ (index.html, ${assetList.map(asset => asset.file).join(', ')})`);
log(`Preview it: npm run preview -- ${slug}`);
