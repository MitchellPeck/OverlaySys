import { describe, expect, it } from "vitest";
import {
  SERVER_SUPABASE_ANON_KEY,
  SERVER_SUPABASE_URL_KEY,
  resolveServerCloudEnv,
} from "./serverEnv";

describe("resolveServerCloudEnv", () => {
  it("mirrors the NEXT_PUBLIC_* pair the desktop actually ships with", () => {
    const out = resolveServerCloudEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc",
    });
    expect(out).toEqual({
      [SERVER_SUPABASE_URL_KEY]: "https://x.supabase.co",
      [SERVER_SUPABASE_ANON_KEY]: "sb_publishable_abc",
    });
  });

  it("lets an explicit OVERLAYSYS_* value win over the NEXT_PUBLIC_* one", () => {
    const out = resolveServerCloudEnv({
      OVERLAYSYS_SUPABASE_URL: "https://override.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc",
    });
    expect(out[SERVER_SUPABASE_URL_KEY]).toBe("https://override.supabase.co");
    expect(out[SERVER_SUPABASE_ANON_KEY]).toBe("sb_publishable_abc");
  });

  it("treats blank values as unset so they fall through", () => {
    const out = resolveServerCloudEnv({
      OVERLAYSYS_SUPABASE_URL: "   ",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    });
    expect(out[SERVER_SUPABASE_URL_KEY]).toBe("https://x.supabase.co");
    expect(out[SERVER_SUPABASE_ANON_KEY]).toBeUndefined();
  });

  it("returns nothing when neither pair is present", () => {
    expect(resolveServerCloudEnv({})).toEqual({});
  });
});
