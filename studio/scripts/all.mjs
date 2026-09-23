import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, fail, parseArgs, project } from './lib.mjs';

// Runs plan -> generate -> finish -> build -> review for one project.
//   npm run all -- <project> --yes      real run (keeps an existing plan.json)
//   npm run all -- <project> --mock     offline test run
const { slug, flags } = parseArgs();
const p = project(slug);
const pass = [flags.mock && '--mock', flags.yes && '--yes'].filter(Boolean);
const steps = [
  ...(existsSync(p.plan) && !flags.replan ? [] : [['plan', pass.filter(flag => flag === '--mock')]]),
  ['generate', pass],
  ['finish', []],
  ['build', []],
  ['review', []],
];
for (const [step, args] of steps) {
  console.log(`\n── ${step} ──`);
  const result = spawnSync(process.execPath, [ path.join('scripts', `${step}.mjs`), slug, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) fail(`Stopped at the ${step} step.`);
  if (step === 'generate' && !flags.mock && !flags.yes) process.exit(0);
}
