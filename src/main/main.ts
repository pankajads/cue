import { app, BrowserWindow, desktopCapturer, Menu, session, Tray, nativeImage } from "electron";
import * as path from "path";
import { registerAudioSourceHandlers } from "./audio-sources";

// LSUIElement-equivalent: no Dock icon, menu-bar/tray-only presence — the
// app lives entirely in the tray, like a background utility.
app.dock?.hide();

let tray: Tray | null = null;
let popoverWindow: BrowserWindow | null = null;

function createPopoverWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 320,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, "../renderer/index.html"));

  // A frameless utility popup should disappear on blur, like a real menu-bar
  // popover, not linger as a stray window.
  window.on("blur", () => {
    if (!window.webContents.isDevToolsOpened()) {
      window.hide();
    }
  });

  return window;
}

function togglePopover(): void {
  if (!popoverWindow) {
    popoverWindow = createPopoverWindow();
  }

  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }

  if (tray) {
    const trayBounds = tray.getBounds();
    const windowBounds = popoverWindow.getBounds();
    const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
    const y = process.platform === "darwin" ? trayBounds.y + trayBounds.height : trayBounds.y - windowBounds.height;
    popoverWindow.setPosition(x, Math.max(y, 0));
  }

  popoverWindow.show();
  popoverWindow.focus();
}

app.whenReady().then(() => {
  registerAudioSourceHandlers();

  // Answers the renderer's navigator.mediaDevices.getDisplayMedia() calls
  // (see renderer.ts's startSystemAudio) by auto-selecting the primary
  // screen source and requesting loopback audio on it. This is the current
  // officially supported way to get system/"remote" audio in Electron — the
  // legacy getUserMedia({ audio: { mandatory: { chromeMediaSource:
  // 'desktop', ... } } }) audio-only pattern this replaced does not fail
  // gracefully: it crashes the whole renderer process (Chromium kills it
  // with "Terminating renderer for bad IPC message, reason 263 /
  // DESKTOP_CAPTURER_INVALID_OR_UNKNOWN_ID"), which is what a blank white
  // popover after clicking "Start listening" was. See ARCHITECTURE.md for
  // the current real caveat: Electron's own shipped types document
  // `audio: 'loopback'` here as Windows-only today, so this fixes the crash
  // everywhere but is only confirmed to deliver real system audio on
  // Windows so far.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"], fetchWindowIcons: false })
      .then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      })
      .catch(() => callback({}));
  });

  const icon = nativeImage.createFromPath(path.join(__dirname, "../../assets/tray-icon.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Sentiment Advisor");
  tray.on("click", togglePopover);

  // Right-click gets a real quit path even before the rest of the UI exists.
  tray.on("right-click", () => {
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([{ label: "Quit", role: "quit" }])
    );
  });

  // Opt-in hook so start-listening.e2e.test.ts can open the popover the same
  // way a real tray click does, without simulating a native click on a tray
  // icon (OS-specific and not something Playwright's Electron driver
  // supports). Only attached when explicitly requested, so it's inert in
  // every real run of the app.
  if (process.env.SENTIMENT_ADVISOR_E2E_TEST_HOOKS === "1") {
    (global as unknown as { __sentimentAdvisorTestHooks: { togglePopover: () => void } }).__sentimentAdvisorTestHooks =
      { togglePopover };
  }
});

// Deliberately no "window-all-closed" handler that calls app.quit(): Electron
// only quits on that event if a handler explicitly requests it, so a tray-only
// app (no document windows) simply omits that call on every platform — the
// popover window closing/hiding must never terminate the app. Only the Quit
// menu item (or Cmd+Q) does.
