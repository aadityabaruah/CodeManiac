# CodeManiac for VS Code

Open **CodeManiac: Open Sidebar** from the Command Palette, or click the code-bracket icon in the Activity Bar. The sidebar starts the local CodeManiac backend when opened, without starting Electron.

## Requirements

- VS Code 1.96 or newer and Node.js 22.18 or newer.
- A trusted local project folder open in VS Code.
- The CodeManiac checkout with dependencies installed and its interface built.
- Codex CLI signed in, or an engine configured through the sidebar's settings.

By default, the app checkout is `~/Downloads/codemaniac`. Set **CodeManiac: App Path** in user settings if it is elsewhere. This companion extension does not bundle the app or your credentials.

On macOS, the Codex desktop app's bundled CLI is detected even when VS Code was
opened from Finder. An unusual installation can be selected with
**CodeManiac: Codex Path** in user settings.

## Coding actions

- **Ask About Selection:** select code, right-click, choose the action, then type your question.
- **Ask About Current File:** sends the open file's current editor contents with your question.
- **Choose Project Folder:** choose the folder to bind in a multi-root workspace.

The agent's working directory is the chosen VS Code folder. New agents start in Ask first mode. Editor contents are sent only when you invoke an ask action. Large context is visibly marked as truncated after 20,000 characters.

The initial Codex model follows the desktop CodeManiac profile when one exists. Set **CodeManiac: Model** before opening a fresh project to choose another. After setup, the sidebar's model picker remains authoritative.

Each project keeps separate chat and agent state under VS Code's extension storage. The extension stops only the server it owns when the VS Code window unloads. **CodeManiac: Stop Sidebar Server** stops it manually. Reconnect from the view toolbar to start it again.

This version supports local VS Code desktop workspaces. Native desktop overlay and computer-control features stay in the separate CodeManiac desktop app.

Based on [Bloks](https://github.com/hamedgitty/bloks), retaining its upstream license and copyright.
