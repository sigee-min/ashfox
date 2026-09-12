'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'dist/public');
for (const retired of ['workbench', 'agent-manifest.json', 'assets/workspaces']) {
  assert.equal(fs.existsSync(path.join(output, retired)), false, `${retired} must not be published`);
}
const descriptor = JSON.parse(fs.readFileSync(path.join(output, 'skills/ashfox/latest.json')));
assert.equal(descriptor.manifestUrl, undefined);
assert.equal(descriptor.workbenchUrl, undefined);
assert.equal(descriptor.documentationUrl, 'https://ashfox.io/docs/guides/agent-workflow/');
const skill = fs.readFileSync(path.join(output, 'skills/ashfox/files/SKILL.md'), 'utf8');
assert.doesNotMatch(skill, /window\.ashfox|agent-manifest|\/workbench\//);
assert.match(skill, /Ashfox CLI/);
const server = spawn(process.execPath, [path.join(__dirname, 'serve.js')], {
  cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
});
const main = async () => {
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview server did not start')), 10_000);
      let text = '';
      server.stdout.on('data', chunk => {
        text += chunk;
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
    });
    const agentResponse = await fetch(origin + '/agent.md');
    assert.equal(agentResponse.status, 200);
    assert.match(agentResponse.headers.get('content-type'), /text\/markdown/);
    const guide = await agentResponse.text();
    const stable = require('../release/stable').readStable(root);
    assert.ok(guide.includes(stable.cli));
    assert.doesNotMatch(guide, /\{\{stable/);
    for (const match of guide.matchAll(/https:\/\/ashfox\.io(\/docs\/[^)\s]+)/g)) {
      assert.equal((await fetch(origin + match[1])).status, 200, match[0]);
    }
    for (const route of ['/',  '/ko/', '/docs/', '/ko/docs/']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route);
      assert.doesNotMatch(await response.text(), /href="(?:https:\/\/ashfox.io)?\/workbench(?:\/|\")|data-ashfox-agent-manifest/);
    }
    for (const route of ['/workbench', '/workbench/', '/workbench/agent-manifest.json', '/agent-manifest.json', '/docs/guides/workbench-api/', '/ko/docs/guides/workbench-api/', '/missing-page']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 404, route);
      assert.match(await response.text(), /Page not found/);
    }
    console.log('Public deployment: localized site and CLI skill served; retired authoring paths return 404');
  } finally { server.kill('SIGTERM'); }
};
void main().catch(error => { console.error(error); process.exitCode = 1; });
