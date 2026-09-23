# Site studio

Turns a written brief into a finished one-screen hero website like Soft Hours:
a full-screen film loop, a new headline and copy, 24 drifting phrases, a new
palette and a new logo. Each step writes a file you can read and edit before
the next step runs.

```
brief.md ──plan──▶ plan.json ──generate──▶ assets/ + manifest.json ──finish──▶ work/ ──build──▶ site/
 (you)            (Claude)                (fal.ai, one asset at a time)       (ffmpeg)         (template)
```

| Step | Command | Tool | What you get |
|---|---|---|---|
| 1. Inspiration | `npm run new -- my-site` | you | `projects/my-site/brief.md` to fill in: references, subject, mood, brand, words, things to avoid |
| 2. Plan | `npm run plan -- my-site` | Claude API (`claude-opus-5`) | `plan.json`: concept, all copy, palette, logo, a **change list** (what changes from the template and why) and an **asset list** with production prompts, tools and dependencies |
| 2b. Revise | `npm run plan -- my-site --revise "warmer light, no people"` | Claude API | the same plan with your feedback applied |
| 3. Generate | `npm run generate -- my-site` then add `--yes` | fal.ai | each asset generated one by one in dependency order: keyframe still, optional end-frame edit, then the image-to-video film. Shows the cost before spending |
| 4. Finish | `npm run finish -- my-site` | ffmpeg | seamless loop (ping-pong or crossfade), 1080p desktop and 720p phone H.264 files, poster JPEG |
| 5. Build | `npm run build -- my-site` | template | `site/`: static `index.html`, media and `assets.json` with SHA-256 checksums, ready to host anywhere |
| Review | `npm run review -- my-site` | – | `review.html`: change list, every asset with its prompt and status, the finished loop and the copy |
| Preview | `npm run preview -- my-site` | Vite | the site at http://localhost:5173 |

`npm run all -- my-site --yes` runs steps 2–5 plus the review. A test run with
no keys and no cost: `npm run all -- my-site --mock` (placeholder media made
locally).

## API keys

You need two keys. Never paste them into a chat or commit them.

| Variable | Used by | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | plan step | https://console.anthropic.com → API keys |
| `FAL_KEY` | generate step (every image and video model) | https://fal.ai/dashboard/keys (add credit under Billing) |

Put them in one of these places, depending on where the pipeline runs:

- **GitHub Actions (works from a phone browser):** in the repository go to
  Settings → Secrets and variables → Actions → New repository secret, and add
  both. Then use the workflow below.
- **Claude Code cloud session:** claude.ai/code in a browser → the environment
  menu → Edit → environment variables. Also allow the network hosts below.
- **Your own computer:** copy `.env.example` to `.env` and fill it in.

`npm run check` confirms the keys are present and the hosts are reachable.

## Network

The pipeline calls `api.anthropic.com`, `queue.fal.run`, `rest.fal.ai` and
`*.fal.media` (uploads and downloads). GitHub Actions and home machines reach
them already; a sandboxed environment needs them added to its allowed domains.

## Running from your phone (GitHub Actions)

1. Add the two secrets (above).
2. Create `studio/projects/<name>/brief.md`: copy `projects/example/brief.md`
   in the GitHub site (Add file → Create new file) or ask Claude to do it.
3. Actions → **Site studio** → Run workflow. Choose the project and
   `step: plan`. The run commits `plan.json` and `review.html` to the branch.
4. Read `plan.json`. To change it, run again with `step: plan` and feedback in
   `revise`, or edit the file directly.
5. Run with `step: all` and **spend** ticked. The run generates the assets,
   finishes the film, builds the site and commits `assets/`, `site/` and the
   updated `review.html`.

## Choosing tools

`config/models.json` lists every tool (fal.ai endpoint), its input fields and
price. `defaults` picks which tool each asset role uses; the planner follows
the defaults unless the brief asks otherwise, and you can change `tool` on any
asset in `plan.json`.

| Role | Default | Alternatives |
|---|---|---|
| keyframe still | `nano-banana-pro` (native 4K) | `gpt-image-2`, `flux-2-max` |
| end frame | `nano-banana-pro-edit` (edits the keyframe) | – |
| hero film | `kling-3-pro` (start + end frame, up to 15 s) | `veo-3.1-flf` (most cinematic, 8 s max), `veo-3.1-i2v`, `minimax-h3` (native 1440p) |

To compare two video models on the same keyframe, copy the `hero-video`
asset in `plan.json` with a new id and tool, generate with `--only <id>`, and
point the `hero_video` role at the better one.

Endpoint ids and field names were checked against fal.ai model pages on
2026-09-23. If a tool starts failing with a validation error, compare its
`input` block with the model's API page on fal.ai.

## Getting good results

- The keyframe decides most of the quality. Regenerate it
  (`npm run generate -- my-site --yes --only keyframe`) until it is right;
  the film and end frame are redone automatically because they depend on it.
- Keep hands and faces small or soft; every current video model still
  distorts them.
- Ping-pong loops play the film backwards, so choose motion with no obvious
  direction (drifting mist, breathing light, water shimmer). For motion that
  must run one way, set `loop.method` to `crossfade` in `plan.json`.
- Aim for a desktop video under about 9 MB; `npm run finish -- my-site --crf 26`
  makes it lighter.

## Files

```
studio/
  config/models.json          tools, endpoints, prices, defaults
  templates/brief.md          the brief questions
  templates/hero-loop/        page template ({{tokens}}) and the Soft Hours baseline values
  scripts/                    one script per step (lib.mjs holds the shared plan schema)
  projects/<name>/
    brief.md  plan.json  manifest.json  review.html
    assets/   generated stills and films      (git-ignored locally)
    work/     loop and encodes                (git-ignored)
    site/     the finished site               (git-ignored locally)
```
