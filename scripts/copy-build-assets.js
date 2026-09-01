// Copies static assets into dist/ after tsc/esbuild have run. Deliberately
// plain Node `fs` rather than shell commands (`mkdir -p`, `cp`) — those are
// POSIX-only and silently fail under Windows' default GitHub Actions shell
// (PowerShell): "The syntax of the command is incorrect." This is real,
// not hypothetical — it's exactly what broke the first Windows release
// build (macOS/Linux never caught it locally, since both have a real POSIX
// shell). `fs`'s API has no such platform split.
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");

function copyInto(srcPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, path.join(destDir, path.basename(srcPath)));
}

copyInto(path.join(repoRoot, "src/renderer/index.html"), path.join(repoRoot, "dist/renderer"));

const ortDestDir = path.join(repoRoot, "dist/renderer/ort");
const ortFiles = [
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
];
for (const file of ortFiles) {
  copyInto(path.join(repoRoot, file), ortDestDir);
}
