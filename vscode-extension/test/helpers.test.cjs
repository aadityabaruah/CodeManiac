'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contextMessage, sidebarHtml, workspaceKey, runtimePath } = require('../helpers.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('selected code cannot terminate its context fence', () => {
  const result = contextMessage({ question: 'Explain', relativePath: 'a.ts', language: 'typescript', text: '```\nexample\n```', startLine: 8 });
  assert.match(result, /starting at line 8/);
  assert.match(result, /````typescript\n```/);
});

test('large context is bounded and disclosed', () => {
  const result = contextMessage({ question: 'Review', relativePath: 'a.ts', text: 'x'.repeat(25000) });
  assert.ok(result.length < 20500);
  assert.match(result, /Context truncated/);
});

test('sidebar escapes folder and error text and limits frames to its own port', () => {
  const html = sidebarHtml({ port: 43210, folder: '/tmp/<img src=x>', error: '<script>bad()</script>' });
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /frame-src http:\/\/127.0.0.1:43210/);
  assert.doesNotMatch(html, /<script>bad/);
});

test('project storage keys are stable and separate', () => {
  assert.equal(workspaceKey('/tmp/a'), workspaceKey('/tmp/a/.'));
  assert.notEqual(workspaceKey('/tmp/a'), workspaceKey('/tmp/b'));
});

test('Finder-started VS Code can discover an existing executable without losing PATH', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codemaniac-cli-'));
  try {
    const cli = path.join(directory, 'codex');
    fs.writeFileSync(cli, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const result = runtimePath('/usr/bin', [cli, path.join(directory, 'missing')]);
    assert.equal(result.split(path.delimiter)[0], directory);
    assert.ok(result.split(path.delimiter).includes('/usr/bin'));
    assert.equal(runtimePath('/usr/bin', ['/does-not-exist/codex']), '/usr/bin');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
