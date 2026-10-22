import type os from "node:os";

function rank(addr: string): number {
  const p = addr.split(".").map(Number) as [number, number];
  if (p[0] === 192 && p[1] === 168) return 0;
  if (p[0] === 10) return 1;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 2;
  return 3;
}

/** Non-internal, non-link-local IPv4 addresses; private LAN ranges first. */
export function lanAddresses(ifaces: ReturnType<typeof os.networkInterfaces>): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      // Node <18.4 reports family as number 4.
      const isV4 = i.family === "IPv4" || (i.family as unknown) === 4;
      if (!isV4 || i.internal || i.address.startsWith("169.254.")) continue;
      if (!out.includes(i.address)) out.push(i.address);
    }
  }
  return out
    .map((a, idx) => ({ a, idx }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.idx - y.idx)
    .map((x) => x.a);
}
