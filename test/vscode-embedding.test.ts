import { test } from "node:test";
import assert from "node:assert/strict";
import { frameAncestors } from "../server/vscode-embedding.ts";

test("the desktop and normal server still refuse framing", () => {
  for (const value of [undefined, "", "0", "true", "https://example.com"]) {
    assert.equal(frameAncestors({ BLOKS_VSCODE_EMBEDDING: value }), "frame-ancestors 'none'");
  }
});

test("the extension-owned server permits VS Code ancestors only", () => {
  const result = frameAncestors({ BLOKS_VSCODE_EMBEDDING: "1" });
  assert.match(result, /vscode-webview:/);
  assert.match(result, /vscode-file:\/\/vscode-app/);
  assert.match(result, /https:\/\/\*\.vscode-cdn\.net/);
  assert.doesNotMatch(result, /(?:^| )\*(?: |$)|http:|unsafe-inline/);
});
