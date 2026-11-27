'use strict';

// Build the static publish directory while keeping private function source outside it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const fail = (message) => { console.error('[Arcade build] ERROR: ' + message); process.exit(1); };

const index = read('index.html');
const app = read('app-builtin.html');
const fn = read('netlify/functions/release.js');
const indexBuild = (index.match(/<meta\s+name="app-build"\s+content="(\d+)"/i) || [])[1];
const appBuild = (app.match(/<meta\s+name="app-build"\s+content="(\d+)"/i) || [])[1];
const functionBuild = (fn.match(/const BASE_BUILD\s*=\s*(\d+)/) || [])[1];

if (!indexBuild || !appBuild || !functionBuild) fail('Could not find the app-build marker in index.html, app-builtin.html, and release.js.');
if (indexBuild !== appBuild || appBuild !== functionBuild) {
  fail(`Build numbers do not match: homepage=${indexBuild}, built-in=${appBuild}, release server=${functionBuild}. Update all three together.`);
}
if (!/<meta\s+name="app-id"\s+content="arcade-journey"/i.test(app) || !/<meta\s+name="app-id"\s+content="arcade-journey"/i.test(index)) fail('The public homepage or built-in app is missing the app-id marker.');
if (!index.includes('/api/release?m=app&b=') || !index.includes('BASE_BUILD = ' + indexBuild)) fail('The public homepage is missing its hot-update check.');
if (!index.includes('google-site-verification') || !index.includes('wxme4PNZe6fK-UO-hGeZhcOFciGhYPJwmQ6Y9Mxw8II')) fail('The public homepage is missing the permanent Search Console verification tag.');
if (!index.includes('id="seo-home-title"') || !index.includes('How to use the calculator')) fail('The public homepage is missing its crawlable homepage content.');
if (!fn.includes("b.action === 'delete'")) fail('The release manager is missing per-release deletion support.');
if (!fn.includes('Build ${build} is too old')) fail('The hot-release baseline guard is missing.');

// Syntax-check every inline executable script in the two HTML entry files.
for (const [name, html] of [['index.html', index], ['app-builtin.html', app]]) {
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match, count = 0;
  while ((match = re.exec(html))) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=|application\/ld\+json/i.test(attrs)) continue;
    try { new vm.Script(match[2], { filename: `${name} inline script ${++count}` }); }
    catch (err) { fail(`${name} has a JavaScript syntax error: ${err.message}`); }
  }
}

// Syntax-check browser AI modules before publishing them.
for (const name of ['arcade-buddy-ai.js', 'arcade-buddy-ai-worker.mjs', 'arcade-identity.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, name)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${name} has a syntax error: ${(result.stderr || result.stdout || '').trim()}`);
}

// Syntax-check every Netlify Function source file with the active Node runtime.
const functionDir = path.join(root, 'netlify', 'functions');
for (const name of fs.readdirSync(functionDir).filter((x) => x.endsWith('.js') || x.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(functionDir, name)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${name} has a syntax error: ${(result.stderr || result.stdout || '').trim()}`);
}

// Publish only files the browser needs. Server code, tools, and project notes stay private.
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const name of ['index.html', 'app-builtin.html', 'robots.txt', 'sitemap.xml', 'arcade-buddy-ai.js', 'arcade-buddy-ai-worker.mjs', 'arcade-identity.js']) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
fs.cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });

console.log(`[Arcade build] OK — built-in build ${appBuild}; ${fs.readdirSync(functionDir).filter((x) => x.endsWith('.js') || x.endsWith('.mjs')).length} Netlify Functions syntax-checked.`);
console.log(`[Arcade build] Published ${dist} with the compact Arcade Buddy chat UI, private account-sync adapter, and static application assets.`);
