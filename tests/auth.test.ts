import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authEnabled,
  createSessionToken,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";

const ORIGINAL = process.env.APP_PASSWORD;

function setPassword(value: string | undefined) {
  if (value === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = value;
}

afterEach(() => {
  setPassword(ORIGINAL);
});

describe("auth gate is opt-in", () => {
  it("is disabled when APP_PASSWORD is unset", () => {
    setPassword(undefined);
    expect(authEnabled()).toBe(false);
  });

  it("is disabled when APP_PASSWORD is blank or whitespace", () => {
    setPassword("");
    expect(authEnabled()).toBe(false);
    setPassword("   ");
    expect(authEnabled()).toBe(false);
  });

  it("is enabled once a real password is configured", () => {
    setPassword("hunter2");
    expect(authEnabled()).toBe(true);
  });

  it("treats every session as valid while disabled, so nothing is gated", async () => {
    setPassword(undefined);
    await expect(verifySessionToken(undefined)).resolves.toBe(true);
    await expect(verifySessionToken("garbage")).resolves.toBe(true);
  });

  it("cannot mint a session while disabled", async () => {
    setPassword(undefined);
    await expect(createSessionToken()).resolves.toBeNull();
  });
});

describe("verifyPassword", () => {
  beforeEach(() => setPassword("correct horse"));

  it("accepts the configured password", async () => {
    await expect(verifyPassword("correct horse")).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    await expect(verifyPassword("wrong horse")).resolves.toBe(false);
  });

  it("rejects empty input", async () => {
    await expect(verifyPassword("")).resolves.toBe(false);
  });

  it("is case and whitespace sensitive", async () => {
    await expect(verifyPassword("Correct Horse")).resolves.toBe(false);
    await expect(verifyPassword("correct horse ")).resolves.toBe(false);
  });

  it("rejects everything when the gate is off", async () => {
    setPassword(undefined);
    await expect(verifyPassword("anything")).resolves.toBe(false);
  });
});

describe("session tokens", () => {
  beforeEach(() => setPassword("s3cret"));

  it("round-trips a freshly minted token", async () => {
    const token = await createSessionToken();
    expect(token).toBeTruthy();
    await expect(verifySessionToken(token)).resolves.toBe(true);
  });

  it("rejects missing or malformed tokens", async () => {
    await expect(verifySessionToken(undefined)).resolves.toBe(false);
    await expect(verifySessionToken("")).resolves.toBe(false);
    await expect(verifySessionToken("nodot")).resolves.toBe(false);
    await expect(verifySessionToken(".abc")).resolves.toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const token = await createSessionToken();
    const [expiry] = token!.split(".");
    await expect(verifySessionToken(`${expiry}.forged`)).resolves.toBe(false);
  });

  it("rejects a tampered expiry (signature no longer matches)", async () => {
    const token = await createSessionToken();
    const separator = token!.lastIndexOf(".");
    const signature = token!.slice(separator + 1);
    const future = Math.floor(Date.now() / 1000) + 999_999;
    await expect(verifySessionToken(`${future}.${signature}`)).resolves.toBe(
      false,
    );
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    await expect(verifySessionToken(`${past}.whatever`)).resolves.toBe(false);
  });

  it("invalidates existing sessions when the password changes", async () => {
    const token = await createSessionToken();
    await expect(verifySessionToken(token)).resolves.toBe(true);

    setPassword("rotated");
    await expect(verifySessionToken(token)).resolves.toBe(false);
  });
});
