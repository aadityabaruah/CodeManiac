'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { sidebarHtml, workspaceKey, contextMessage, runtimePath } = require('./helpers.cjs');
const exec = promisify(execFile);
let provider;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function machineSetting(name) {
  return vscode.workspace.getConfiguration('codemaniac').inspect(name)?.globalValue || '';
}

async function nodeExecutable() {
  const candidates = [machineSetting('nodePath'), 'node', '/opt/homebrew/bin/node', '/usr/local/bin/node'].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      const { stdout } = await exec(candidate, ['--version'], { timeout: 5000 });
      const [major, minor] = stdout.trim().replace(/^v/, '').split('.').map(Number);
      if (major > 22 || (major === 22 && minor >= 18)) return candidate;
    } catch { /* Try the next local installation. */ }
  }
  throw new Error('Install Node.js 22.18 or newer, or set CodeManiac: Node Path in VS Code settings.');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

class Sidebar {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel('CodeManiac');
    context.subscriptions.push(this.output);
    this.child = null;
    this.port = null;
    this.botId = null;
    this.folder = null;
    this.starting = null;
    this.disposed = false;
  }

  async resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage(message => {
      const command = { askSelection: 'codemaniac.askSelection', askFile: 'codemaniac.askFile', retry: 'codemaniac.reload' }[message?.type];
      if (command) void vscode.commands.executeCommand(command);
    }, undefined, this.context.subscriptions);
    await this.load();
  }

  paint(options = {}) {
    if (!this.view) return;
    this.view.webview.html = sidebarHtml({ port: this.port, folder: this.folder?.uri.fsPath, ...options });
    this.view.description = this.folder?.name || '';
  }

  async load() {
    this.paint({ loading: true });
    try {
      await this.ensureStarted();
      if (!this.disposed) this.paint();
    } catch (error) {
      this.output.appendLine(error.stack || String(error));
      this.paint({ error: error.message || String(error) });
    }
  }

  async api(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
      method: options.method || 'GET',
      ...(options.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(options.timeout || 20000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `CodeManiac returned HTTP ${response.status}`);
    return body;
  }

  async chooseFolder() {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) throw new Error('Open a local project folder in VS Code, then reconnect CodeManiac.');
    if (folders.some(folder => folder.uri.scheme !== 'file')) throw new Error('This first version supports local project folders.');
    const saved = this.context.workspaceState.get('folder');
    this.folder = folders.find(folder => folder.uri.toString() === saved)
      || (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri))
      || folders[0];
    return this.folder;
  }

  async ensureStarted() {
    if (this.disposed) throw new Error('CodeManiac has stopped.');
    if (this.child && this.port && this.botId) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async start() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before starting a coding agent.');
    await this.chooseFolder();
    const appPath = path.resolve(machineSetting('appPath') || path.join(os.homedir(), 'Downloads', 'codemaniac'));
    if (!fs.existsSync(path.join(appPath, 'server', 'vscode-embedding.ts')) || !fs.existsSync(path.join(appPath, 'dist', 'index.html'))) {
      throw new Error('Choose the CodeManiac app folder in Settings (CodeManiac: App Path), then build it with npm run build.');
    }
    const node = await nodeExecutable();
    const codexPath = machineSetting('codexPath');
    const codexCandidates = [
      codexPath,
      ...['/Applications', path.join(os.homedir(), 'Applications')].flatMap(root => [
        path.join(root, 'Codex.app', 'Contents', 'Resources', 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex'),
        path.join(root, 'Codex.app', 'Contents', 'Resources', 'codex'),
      ]),
    ].filter(Boolean);
    const dataDir = path.join(this.context.globalStorageUri.fsPath, 'projects', workspaceKey(this.folder.uri.fsPath));
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const configPath = path.join(dataDir, 'config.json');
    if (!fs.existsSync(configPath)) await fsp.writeFile(configPath, JSON.stringify({ setupDoneAt: Date.now() }) + '\n', { mode: 0o600 });
    this.port = await freePort();
    this.output.appendLine(`Starting sidebar server for ${this.folder.name} on port ${this.port}`);
    let lastError = '';
    const child = spawn(node, [path.join(appPath, 'server', 'index.ts')], {
      cwd: appPath,
      env: { ...process.env, PATH: runtimePath(process.env.PATH, codexCandidates), BLOKS_PORT: String(this.port), BLOKS_DATA_DIR: dataDir, BLOKS_STATIC_DIR: path.join(appPath, 'dist'), BLOKS_VSCODE_EMBEDDING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on('data', data => this.output.append(data.toString()));
    child.stderr.on('data', data => { lastError = (lastError + data.toString()).slice(-4000); this.output.append(data.toString()); });
    child.on('error', error => { lastError = error.message; });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.botId = null;
      if (!this.disposed) this.paint({ error: `CodeManiac stopped (${signal || code}). Use Retry to reconnect.` });
    });
    try {
      const deadline = Date.now() + 45000;
      let healthy = false;
      while (Date.now() < deadline && !this.disposed) {
        if (child.exitCode !== null || child.signalCode) throw new Error(lastError || 'The CodeManiac server exited during startup.');
        try {
          const health = await this.api('/api/health', { timeout: 2000 });
          if (health.pid === child.pid && health.static) { healthy = true; break; }
        } catch { /* Wait for this owned process, never attach to another server. */ }
        await pause(250);
      }
      if (!healthy) throw new Error('CodeManiac did not finish starting. See the CodeManiac output channel.');
      const bots = (await this.api('/api/bots?messages=0')).bots || [];
      const savedId = this.context.workspaceState.get(`agent:${workspaceKey(this.folder.uri.fsPath)}`);
      let bot = bots.find(bot => bot.id === savedId && !bot.archivedAt) || bots.find(bot => !bot.archivedAt);
      if (!bot) bot = await this.api('/api/bots', { method: 'POST', body: { name: 'CodeManiac', title: 'Coding assistant' } });
      let selection;
      if (!savedId) {
        try {
          const desktop = JSON.parse(await fsp.readFile(path.join(appPath, '.codemaniac-data', 'bots.json'), 'utf8'));
          selection = desktop.find(bot => !bot.archivedAt && bot.modelSelection?.instanceId === 'codex')?.modelSelection;
        } catch { /* A desktop profile is optional. */ }
        const configured = vscode.workspace.getConfiguration('codemaniac', this.folder.uri).get('model');
        selection = { instanceId: 'codex', model: configured || selection?.model || 'gpt-6.1-terra' };
      }
      await this.api(`/api/bots/${bot.id}`, { method: 'PATCH', body: {
        cwd: this.folder.uri.fsPath,
        ...(!savedId ? { name: 'CodeManiac', title: 'Coding assistant', modelSelection: selection, approvals: 'ask' } : {}),
      } });
      this.botId = bot.id;
      await this.context.workspaceState.update(`agent:${workspaceKey(this.folder.uri.fsPath)}`, bot.id);
      await this.context.workspaceState.update('folder', this.folder.uri.toString());
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async ask(kind, suppliedQuestion) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') return vscode.window.showInformationMessage('Open a code file first.');
    const selected = kind === 'selection';
    if (selected && editor.selection.isEmpty) return vscode.window.showInformationMessage('Select some code first.');
    const snapshot = {
      file: editor.document.uri,
      text: selected ? editor.document.getText(editor.selection) : editor.document.getText(),
      language: editor.document.languageId,
      startLine: selected ? editor.selection.start.line + 1 : 1,
    };
    const question = typeof suppliedQuestion === 'string' ? suppliedQuestion : await vscode.window.showInputBox({
      title: selected ? 'Ask CodeManiac about selected code' : 'Ask CodeManiac about this file',
      prompt: 'What would you like CodeManiac to do?',
      value: selected ? 'Explain this code and suggest improvements.' : 'Review this file and suggest improvements.',
      ignoreFocusOut: true,
    });
    if (!question?.trim()) return;
    await vscode.commands.executeCommand('codemaniac.open');
    await this.ensureStarted();
    const folder = vscode.workspace.getWorkspaceFolder(snapshot.file);
    if (!folder || folder.uri.toString() !== this.folder.uri.toString()) throw new Error('Choose this file’s project using CodeManiac: Choose Project Folder first.');
    const text = contextMessage({ question: question.trim(), relativePath: vscode.workspace.asRelativePath(snapshot.file), language: snapshot.language, text: snapshot.text, startLine: snapshot.startLine });
    await this.api(`/api/bots/${this.botId}/messages`, { method: 'POST', body: { text } });
  }

  async pickWorkspace() {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) return vscode.commands.executeCommand('vscode.openFolder');
    const selected = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { title: 'CodeManiac project folder' });
    if (!selected) return;
    if (this.port && this.botId) {
      const bots = (await this.api('/api/bots?messages=0')).bots || [];
      const active = bots.find(bot => bot.id === this.botId);
      if (active?.busy || active?.tasks?.some(task => task.busy)) throw new Error('Stop the active agent turn before changing projects.');
    }
    await this.stop();
    await this.context.workspaceState.update('folder', selected.folder.uri.toString());
    await this.load();
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.port = null;
    this.botId = null;
    if (!child || child.exitCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 5000);
      timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
    });
  }
}

function activate(context) {
  provider = new Sidebar(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codemaniac.chat', provider));
  const command = (name, action) => context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
    try { return await action(...args); } catch (error) { provider.output.appendLine(error.stack || String(error)); void vscode.window.showErrorMessage(`CodeManiac: ${error.message || error}`); }
  }));
  command('codemaniac.open', () => vscode.commands.executeCommand('codemaniac.chat.focus'));
  command('codemaniac.askSelection', question => provider.ask('selection', question));
  command('codemaniac.askFile', question => provider.ask('file', question));
  command('codemaniac.chooseWorkspace', () => provider.pickWorkspace());
  command('codemaniac.reload', async () => { if (!provider.child) await provider.load(); else provider.paint(); });
  command('codemaniac.stopServer', async () => { await provider.stop(); provider.paint({ error: 'CodeManiac is stopped. Use Retry to reconnect.' }); });
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    if (provider.folder && !vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === provider.folder.uri.toString())) {
      await provider.stop();
      await context.workspaceState.update('folder', undefined);
      await provider.load();
    }
  }));
  return { state: () => ({ port: provider.port, botId: provider.botId, folder: provider.folder?.uri.fsPath, pid: provider.child?.pid }) };
}

async function deactivate() {
  if (!provider) return;
  provider.disposed = true;
  await provider.stop();
}

module.exports = { activate, deactivate };
