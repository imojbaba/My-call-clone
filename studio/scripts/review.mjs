import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, log, parseArgs, project, readJson, requireFile } from './lib.mjs';

// Writes projects/<project>/review.html: the concept, change list and every asset
// with its prompt, tool, status and preview, for reviewing a run in a browser.
const { slug } = parseArgs();
const p = project(slug);
requireFile(p.plan, `Run: npm run plan -- ${slug}`);
const plan = await readJson(p.plan);
const manifest = await readJson(p.manifest, { assets: {} });
const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

const preview = record => {
  if (record?.status !== 'done') return `<div class="empty">${esc(record?.status === 'failed' ? `Failed: ${record.error}` : 'Not generated yet')}</div>`;
  return record.file.endsWith('.mp4')
    ? `<video src="${esc(record.file)}" controls muted loop playsinline></video>`
    : `<img src="${esc(record.file)}" alt="">`;
};

const assets = plan.assets.map(asset => {
  const record = manifest.assets[asset.id];
  const meta = [asset.role, asset.tool, asset.aspect_ratio, asset.duration_seconds ? `${asset.duration_seconds}s` : '', asset.depends_on.length ? `from ${asset.depends_on.join(' + ')}` : '']
    .filter(Boolean).map(esc).join(' · ');
  return `<article>
    ${preview(record)}
    <h3>${esc(asset.id)} <span class="status ${esc(record?.status || 'pending')}">${esc(record?.status || 'pending')}</span></h3>
    <p class="meta">${meta}</p>
    <p><strong>Prompt</strong> ${esc(asset.prompt)}</p>
    <p><strong>Avoid</strong> ${esc(asset.negative_prompt)}</p>
    <p><strong>Check</strong> ${esc(asset.notes)}</p>
  </article>`;
}).join('\n');

const finished = manifest.finished
  ? `<h2>Finished media</h2><div class="grid"><article><video src="${esc(manifest.finished.files.video.file)}" controls muted loop playsinline autoplay></video>
     <p class="meta">${esc(manifest.finished.method)} loop · desktop ${(manifest.finished.files.video.bytes / 1e6).toFixed(2)} MB · phone ${(manifest.finished.files.mobile.bytes / 1e6).toFixed(2)} MB</p></article></div>`
  : '';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plan.site.brand_name)} review</title>
<style>
  :root { --bg: #f6f4ef; --fg: #1d1d1b; --muted: #6b6a66; --line: #dedad2; --ok: #2f7d4f; --bad: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #efede8; --muted: #a09e98; --line: #34332f; --ok: #7fc79a; --bad: #f2a29c; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 36px 0 12px; } h3 { font-size: 16px; margin: 12px 0 2px; }
  .meta, .empty { color: var(--muted); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; } td, th { text-align: left; vertical-align: top; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); }
  .table { overflow-x: auto; }
  .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
  article img, article video { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: var(--line); display: block; }
  .empty { aspect-ratio: 16 / 9; border: 1px dashed var(--line); border-radius: 8px; display: grid; place-items: center; padding: 12px; text-align: center; }
  .status { font-size: 12px; font-weight: 500; } .done { color: var(--ok); } .failed { color: var(--bad); } .pending { color: var(--muted); }
  .swatches { display: flex; gap: 8px; } .swatch { width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--line); }
  ol { padding-left: 20px; columns: 2 220px; }
</style></head>
<body><main>
  <h1>${esc(plan.site.brand_name)}</h1>
  <p class="meta">${esc(plan.concept)}</p>
  <div class="swatches">${Object.entries(plan.palette).map(([name, hex]) => `<div class="swatch" title="${esc(name)} ${esc(hex)}" style="background:${esc(hex)}"></div>`).join('')}</div>
  <h2>What changes</h2>
  <div class="table"><table><tr><th>Area</th><th>From</th><th>To</th><th>Why</th></tr>
  ${plan.changes.map(change => `<tr><td>${esc(change.area)}</td><td>${esc(change.from)}</td><td>${esc(change.to)}</td><td>${esc(change.why)}</td></tr>`).join('\n')}
  </table></div>
  <h2>Assets, in generation order</h2>
  <div class="grid">${assets}</div>
  ${finished}
  <h2>Copy</h2>
  <p><strong>${esc(plan.site.headline_sans)}</strong><br><em>${esc(plan.site.headline_serif)}</em><br>${esc(plan.site.subheading)}<br>Button: ${esc(plan.site.cta)} · Footer: ${esc(plan.site.footer)}</p>
  <ol>${plan.site.phrases.map(phrase => `<li>${esc(phrase)}</li>`).join('')}</ol>
</main></body></html>
`;
await writeFile(p.review, html);
log(`Wrote ${path.relative(ROOT, p.review)}`);
