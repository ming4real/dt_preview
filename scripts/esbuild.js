const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const monacoSource = path.join(root, "node_modules", "monaco-editor", "min", "vs");
const monacoTarget = path.join(root, "media", "monaco", "vs");

const monacoAssets = new Set([
  "loader.js",
  "nls.messages-loader.js",
  "editor/editor.main.js",
  "editor/editor.main.css",
  "basic-languages/monaco.contribution.js",
]);

function copyFile(relativePath) {
  const from = path.join(monacoSource, relativePath);
  const to = path.join(monacoTarget, relativePath);

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(monacoTarget, { recursive: true, force: true });
for (const item of fs.readdirSync(monacoSource)) {
  if (
    item.startsWith("workers-")
    || item.startsWith("editor.api-")
    || item.startsWith("monaco.contribution-")
  ) {
    monacoAssets.add(item);
  }
  if (item.startsWith("nls.messages.") && item.endsWith(".js.js")) {
    monacoAssets.add(item);
  }
}
for (const item of fs.readdirSync(path.join(monacoSource, "assets"))) {
  if (item.startsWith("editor.worker-") && item.endsWith(".js")) {
    monacoAssets.add(path.join("assets", item));
  }
}
for (const asset of monacoAssets) {
  copyFile(asset);
}

esbuild.buildSync({
  bundle: true,
  entryPoints: [path.join(root, "src", "extension.ts")],
  external: ["vscode"],
  format: "cjs",
  outfile: path.join(root, "out", "extension.js"),
  platform: "node",
  sourcemap: true,
  sourcesContent: false,
  target: "node22",
});
