import { describe, expect, it } from "vitest";
import type os from "node:os";
import { lanAddresses } from "./networkInfo";

type Ifaces = ReturnType<typeof os.networkInterfaces>;
const v4 = (address: string, internal = false) => ({
  address, family: "IPv4" as const, internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null,
});
const v6 = (address: string) => ({
  address, family: "IPv6" as const, internal: false, netmask: "ffff::", mac: "00:00:00:00:00:00", cidr: null, scopeid: 0,
});

describe("lanAddresses", () => {
  it("excludes loopback, IPv6 and link-local", () => {
    const ifaces: Ifaces = {
      lo0: [v4("127.0.0.1", true), v6("::1")],
      en0: [v4("192.168.1.20"), v6("fe80::1")],
      en1: [v4("169.254.3.4")],
    };
    expect(lanAddresses(ifaces)).toEqual(["192.168.1.20"]);
  });
  it("orders private ranges before public", () => {
    const ifaces: Ifaces = {
      a: [v4("8.8.4.4")],
      b: [v4("172.20.0.5")],
      c: [v4("10.0.0.7")],
      d: [v4("192.168.0.9")],
      e: [v4("172.32.0.1")],
    };
    expect(lanAddresses(ifaces)).toEqual(["192.168.0.9", "10.0.0.7", "172.20.0.5", "8.8.4.4", "172.32.0.1"]);
  });
  it("handles undefined entries and dedupes", () => {
    const ifaces: Ifaces = { a: undefined, b: [v4("10.0.0.2")], c: [v4("10.0.0.2")] };
    expect(lanAddresses(ifaces)).toEqual(["10.0.0.2"]);
  });
});
