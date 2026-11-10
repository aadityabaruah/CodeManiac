'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

function runtimePath(original, candidates) {
  const detected = candidates.filter(file => {
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
    catch { return false; }
  }).map(file => path.dirname(file));
  return [...new Set([...detected, ...(original || '').split(path.delimiter)].filter(Boolean))].join(path.delimiter);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function workspaceKey(folder) {
  return crypto.createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 20);
}

function contextMessage({ question, relativePath, language, text, startLine, maxChars = 20000 }) {
  const clipped = text.length > maxChars;
  // Fence length follows the contents so code cannot break out of its block.
  const runs = text.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${question}\n\nEditor context from ${relativePath}${startLine ? `, starting at line ${startLine}` : ''}:\n${fence}${language || ''}\n${text.slice(0, maxChars)}\n${fence}${clipped ? '\n[Context truncated to 20,000 characters.]' : ''}`;
}

function sidebarHtml({ port, folder, loading, error }) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const origin = `http://127.0.0.1:${port}`;
  const message = error ? escapeHtml(error) : loading ? 'Starting CodeManiac…' : '';
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-src ${port ? origin : "'none'"}; base-uri 'none'; form-action 'none'">
<title>CodeManiac</title><style nonce="${nonce}">
html,body{margin:0;height:100%;overflow:hidden;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
body{display:flex;flex-direction:column}.bar{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);min-width:0}.folder{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:11px;color:var(--vscode-descriptionForeground)}button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;border-radius:3px;padding:4px 7px;cursor:pointer;font:inherit}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}iframe{border:0;width:100%;flex:1;min-height:0}.status{padding:18px;line-height:1.5}.error{color:var(--vscode-errorForeground)}
</style></head><body><div class="bar"><span class="folder" title="${escapeHtml(folder || '')}">${escapeHtml(folder ? path.basename(folder) : 'No project folder')}</span><button id="selection" title="Ask about selected code">Selection</button><button id="file" title="Ask about the current file">File</button></div>
${message ? `<div class="status${error ? ' error' : ''}">${message}${error ? '<p><button id="retry">Retry</button></p>' : ''}</div>` : `<iframe title="CodeManiac chat" src="${origin}/?vscode=1" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"></iframe>`}
<script nonce="${nonce}">const vscode=acquireVsCodeApi();for(const [id,type] of [['selection','askSelection'],['file','askFile'],['retry','retry']]){document.getElementById(id)?.addEventListener('click',()=>vscode.postMessage({type}));}</script></body></html>`;
}

module.exports = { escapeHtml, workspaceKey, contextMessage, sidebarHtml, runtimePath };
