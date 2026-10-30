import { describe, expect, it } from "vitest";
import { isDifferentUser, jwtSubject } from "./tokenUser";

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(claims)}.sig`;
}

describe("jwtSubject", () => {
  it("reads the sub claim", () => {
    expect(jwtSubject(jwt({ sub: "user-a" }))).toBe("user-a");
  });

  it("is null for anything that isn't a JWT with a string sub", () => {
    expect(jwtSubject("not-a-jwt")).toBeNull();
    expect(jwtSubject(jwt({ sub: 42 }))).toBeNull();
    expect(jwtSubject("a.%%%.c")).toBeNull();
  });
});

describe("isDifferentUser", () => {
  it("flags a refresh that belongs to another account", () => {
    // An old operator-side session refreshing over the desktop's sign-in
    // paired one account's tokens with another account's org.
    expect(isDifferentUser(jwt({ sub: "grace" }), jwt({ sub: "personal" }))).toBe(true);
  });

  it("accepts a refresh for the same account", () => {
    expect(isDifferentUser(jwt({ sub: "grace" }), jwt({ sub: "grace" }))).toBe(false);
  });

  it("doesn't block when either side can't be read", () => {
    expect(isDifferentUser(null, jwt({ sub: "grace" }))).toBe(false);
    expect(isDifferentUser("opaque", jwt({ sub: "grace" }))).toBe(false);
  });
});
