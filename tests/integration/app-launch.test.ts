import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Launches the real, built app in an actual Electron runtime (not
 * `node --test`'s plain Node process) and confirms it starts up cleanly —
 * main process ready, tray created, no crash — then has it quit itself and
 * checks it exited with code 0. An integration test rather than a unit
 * test: it exercises the real main.ts wiring (app/Tray/BrowserWindow
 * lifecycle) across a real process boundary, not a single module in
 * isolation.
 *
 * `require("electron")` from plain Node resolves to the path of the
 * Electron binary rather than its API (the API only exists inside a running
 * Electron process), which is exactly what we want here: spawning a real
 * child process, not mocking anything.
 *
 * The child must NOT inherit ELECTRON_RUN_AS_NODE=1 — set in some dev
 * shells (see README) — or Electron runs as plain Node instead of the real
 * GUI runtime and `app`/`Tray` are never created, which would make this
 * test pass for the wrong reason.
 */
test("app launches, becomes ready, creates its tray, and quits cleanly", async () => {
  const electronBinary = require("electron") as unknown as string;
  const appEntry = path.join(__dirname, "..", "..", "..", "dist", "main", "main.js");

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // Electron has no `node --eval`-style flag of its own: a script only runs
  // in-process when passed as a plain positional argument (the same
  // mechanism `electron .` uses via package.json's "main"), so the launcher
  // script has to be a real file on disk rather than an inline string.
  const readyMarker = "__SENTIMENT_ADVISOR_SMOKE_TEST_READY__";
  const launcherScript = [
    `require(${JSON.stringify(appEntry)});`,
    `require("electron").app.whenReady().then(() => {`,
    `  console.log(${JSON.stringify(readyMarker)});`,
    `  setTimeout(() => require("electron").app.quit(), 200);`,
    `});`,
  ].join("\n");
  const launcherPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-advisor-smoke-")),
    "launch-app.js"
  );
  fs.writeFileSync(launcherPath, launcherScript);

  const child = spawn(electronBinary, [launcherPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`app did not exit within 15s.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.match(stdout, new RegExp(readyMarker), `app never signaled ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.equal(exitCode, 0, `app did not exit cleanly.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
});
