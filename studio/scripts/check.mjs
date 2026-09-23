// Checks that the API keys are present and the hosts the pipeline calls are reachable.
const checks = [
  ['ANTHROPIC_API_KEY', 'plan step (Claude)'],
  ['FAL_KEY', 'generate step (fal.ai)'],
];
let ok = true;
for (const [name, use] of checks) {
  const set = Boolean(process.env[name]);
  ok &&= set;
  console.log(`${set ? '✔' : '✖'} ${name} ${set ? 'is set' : 'is missing'} (${use})`);
}
const hosts = ['api.anthropic.com', 'queue.fal.run', 'rest.fal.ai', 'v3.fal.media', 'v3b.fal.media'];
for (const host of hosts) {
  // Sandboxed networks answer blocked hosts themselves with 403 + x-deny-reason; any other reply means the host answered.
  const reached = await fetch(`https://${host}/`, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    .then(response => !response.headers.get('x-deny-reason'), () => false);
  ok &&= reached;
  console.log(`${reached ? '✔' : '✖'} https://${host} ${reached ? 'reachable' : 'blocked or unreachable'}`);
}
console.log(ok ? '\nReady.' : '\nFix the ✖ lines first. See README.md, "API keys" and "Network".');
process.exit(ok ? 0 : 1);
