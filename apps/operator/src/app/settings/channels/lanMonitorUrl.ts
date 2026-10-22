export interface LanMonitorUrlInput {
  rendererBase: string;
  /** True when rendererBase came from the desktop host (not the web fallback). */
  fromDesktop: boolean;
  address: string;
  port: number;
  channelId: string;
}

/**
 * Dev (desktop pointing at the Vite renderer): reuse rendererBase with its
 * hostname swapped for the LAN address. Otherwise the server-served renderer
 * at /renderer/ on the server's bound port.
 */
export function lanMonitorUrl(i: LanMonitorUrlInput): string {
  const q = `?channel=${encodeURIComponent(i.channelId)}`;
  if (i.fromDesktop) {
    try {
      const u = new URL(i.rendererBase);
      if (!u.pathname.startsWith("/renderer")) {
        u.hostname = i.address;
        const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
        return `${u.protocol}//${u.host}${path}${q}`;
      }
    } catch {
      /* fall through */
    }
  }
  return `http://${i.address}:${i.port}/renderer/${q}`;
}
