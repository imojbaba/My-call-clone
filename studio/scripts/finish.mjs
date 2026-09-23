import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, fail, ffmpeg, fileInfo, log, mediaDuration, parseArgs, project, readJson, requireFile, writeJson } from './lib.mjs';

// Step 4: turn the generated film into web-ready media.
//   loop (plan.loop.method) -> 1080p H.264 for desktop, 720p for phones, poster JPEG.
//   npm run finish -- <project> [--crf 23]
const { slug, flags } = parseArgs();
const p = project(slug);
requireFile(p.manifest, `Run: npm run generate -- ${slug}`);
const plan = await readJson(p.plan);
const manifest = await readJson(p.manifest);
const hero = plan.assets.find(asset => asset.role === 'hero_video');
const record = manifest.assets[hero.id];
if (record?.status !== 'done') fail(`The hero video "${hero.id}" has not been generated. Run: npm run generate -- ${slug} --yes`);

await mkdir(p.work, { recursive: true });
const source = path.join(p.dir, record.file);
const master = path.join(p.work, 'master.mp4');
const loop = path.join(p.work, 'loop.mp4');

log('Normalising to 24 fps, at most 1920 px wide...');
await ffmpeg(['-i', source, '-an', '-vf', "fps=24,scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p", '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', master]);

const method = plan.loop.method;
const duration = await mediaDuration(master);
log(`Building the loop (${method}, source ${duration.toFixed(1)} s)...`);
if (method === 'pingpong') {
  // Forward, then reversed without its first frame so the turn does not stutter.
  await ffmpeg(['-i', master, '-filter_complex', '[0]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', loop]);
} else if (method === 'crossfade') {
  // Drop the first second, then fade that second back in over the tail: the last
  // frame of the output is the frame right before the first, so the wrap is seamless.
  const fade = Math.min(1, duration / 4);
  const filter = `[0]split[a][b];[a]trim=${fade}:${duration},setpts=PTS-STARTPTS,fps=24[main];[b]trim=0:${fade},setpts=PTS-STARTPTS,fps=24[head];[main][head]xfade=transition=fade:duration=${fade}:offset=${(duration - 2 * fade).toFixed(3)}[v]`;
  await ffmpeg(['-i', master, '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', loop]);
} else {
  await ffmpeg(['-i', master, '-c', 'copy', loop]);
}

const crf = String(flags.crf || 23);
const outputs = {
  video: path.join(p.work, 'hero-loop.mp4'),
  mobile: path.join(p.work, 'hero-loop-720.mp4'),
  poster: path.join(p.work, 'hero-poster.jpg'),
};
const web = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '48', '-movflags', '+faststart'];
log('Encoding desktop and phone versions...');
// CRF sets the quality; maxrate caps busy scenes so a 20 s loop stays near 9 MB (desktop) and 4 MB (phone).
await ffmpeg(['-i', loop, ...web, '-crf', crf, '-maxrate', '3.5M', '-bufsize', '7M', outputs.video]);
await ffmpeg(['-i', loop, '-vf', "scale='min(1280,iw)':-2:flags=lanczos", ...web, '-crf', String(Number(crf) + 3), '-maxrate', '1.5M', '-bufsize', '3M', outputs.mobile]);
await ffmpeg(['-i', loop, '-frames:v', '1', '-q:v', '3', outputs.poster]);

const finished = { method, source: record.file, crf: Number(crf), files: {} };
for (const [key, file] of Object.entries(outputs)) {
  finished.files[key] = { file: path.relative(p.dir, file), ...(await fileInfo(file)) };
  log(`  ${path.relative(ROOT, file)}  ${(finished.files[key].bytes / 1e6).toFixed(2)} MB`);
}
if (finished.files.video.bytes > 9e6) log('  The desktop video is over 9 MB; try --crf 26 for a lighter page.');
manifest.finished = finished;
await writeJson(p.manifest, manifest);
log(`Done. Next: npm run build -- ${slug}`);
