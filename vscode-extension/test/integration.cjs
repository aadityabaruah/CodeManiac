'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vscode = require('vscode');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const reportPath = process.env.CODEMANIAC_TEST_REPORT || path.join(os.tmpdir(), 'codemaniac-vscode-integration.json');

async function until(check, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await wait(300);
  }
  throw new Error('Timed out waiting for VS Code integration.');
}

async function run() {
  const extension = vscode.extensions.getExtension('aadityabaruah.codemaniac-sidebar');
  assert.ok(extension, 'extension is registered');
  const api = await extension.activate();
  try {
    await vscode.commands.executeCommand('codemaniac.open');
    const state = await until(() => { const state = api.state(); return state.botId && state.port ? state : null; });
    const base = `http://127.0.0.1:${state.port}`;
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.pid, state.pid);
    assert.equal(health.static, true);
    const page = await fetch(base);
    assert.match(page.headers.get('content-security-policy'), /vscode-webview:/);
    const bots = (await (await fetch(base + '/api/bots?messages=0')).json()).bots;
    const bot = bots.find(bot => bot.id === state.botId);
    assert.equal(bot.cwd, vscode.workspace.workspaceFolders[0].uri.fsPath);
    assert.equal(bot.approvals, 'ask');
    const instances = (await (await fetch(base + '/api/instances')).json()).instances;
    const codex = instances.find(instance => instance.instanceId === 'codex');
    assert.equal(codex.snapshot.state, 'available');
    assert.equal(codex.snapshot.authenticated, true);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'sample.py'));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, document.lineCount, 0);
    const expected = 'SELECTION_OK_' + Date.now();
    await vscode.commands.executeCommand('codemaniac.askSelection', `Read the selected code, then reply with exactly ${expected}. Do not use tools.`);
    const message = await until(async () => {
      const response = await fetch(base + `/api/bots/${state.botId}/messages`);
      const data = await response.json();
      const messages = data.messages || [];
      assert.ok(messages.some(row => JSON.stringify(row).includes('def add(a, b):')), 'selection was included');
      return messages.find(row => row.role === 'bot' && JSON.stringify(row).includes(expected));
    }, 120000);
    fs.writeFileSync(reportPath, JSON.stringify({ passed: true, state, model: bot.modelSelection, assistant: message }, null, 2));
    await vscode.commands.executeCommand('codemaniac.stopServer');
    await until(async () => { try { await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 10000);
  } catch (error) {
    fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: error.stack, state: api.state() }, null, 2));
    throw error;
  }
}

module.exports = { run };
