import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import * as path from "path";
import { registerAudioSourceHandlers } from "./audio-sources";

// LSUIElement-equivalent: no Dock icon, menu-bar/tray-only presence, matching
// the original app's AppDelegate + MenuBarExtra behavior.
app.dock?.hide();

let tray: Tray | null = null;
let popoverWindow: BrowserWindow | null = null;

function createPopoverWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 320,
    height: 420,
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
});

// Deliberately no "window-all-closed" handler that calls app.quit(): Electron
// only quits on that event if a handler explicitly requests it, so a tray-only
// app (no document windows) simply omits that call on every platform — the
// popover window closing/hiding must never terminate the app. Only the Quit
// menu item (or Cmd+Q) does.
