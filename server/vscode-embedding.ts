/** Only an extension-owned server may be framed by the VS Code workbench. */
export function frameAncestors(env: Record<string, string | undefined> = process.env): string {
  if (env.BLOKS_VSCODE_EMBEDDING !== "1") return "frame-ancestors 'none'";
  return "frame-ancestors vscode-webview: vscode-file://vscode-app https://*.vscode-cdn.net";
}
