import { BrowserWindow, screen } from "electron";

/**
 * Open a transparent, click-through overlay on each display showing a
 * large number for ~2 seconds, so the operator can match the
 * numbered choices in the channel-window-settings dropdown to the
 * physical screen.
 *
 * Each overlay is its own BrowserWindow; they all close themselves
 * after the timeout.
 */
export function identifyDisplays(durationMs = 2000): void {
  const displays = screen.getAllDisplays();
  for (let i = 0; i < displays.length; i++) {
    const d = displays[i];
    if (!d) continue;
    const winW = Math.min(480, d.bounds.width);
    const winH = Math.min(360, d.bounds.height);
    const win = new BrowserWindow({
      width: winW,
      height: winH,
      x: d.bounds.x + Math.floor((d.bounds.width - winW) / 2),
      y: d.bounds.y + Math.floor((d.bounds.height - winH) / 2),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      backgroundColor: "#00000000",
    });
    win.setIgnoreMouseEvents(true);

    const html = `<!doctype html><html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center;height:100vh;">
<div style="font-family:system-ui,sans-serif;font-size:240px;font-weight:900;color:#fff;text-shadow:0 8px 32px rgba(0,0,0,0.85),0 0 4px rgba(0,0,0,1);line-height:1;">${i + 1}</div>
<div style="position:fixed;bottom:24px;left:0;right:0;text-align:center;font-family:system-ui,sans-serif;font-size:18px;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,0.9);">${d.label || `Display ${i + 1}`}</div>
</body></html>`;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

    setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, durationMs);
  }
}
