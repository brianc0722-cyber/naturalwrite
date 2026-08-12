import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "@/lib/llm-opinion";

/**
 * OPENAI_BASE_URL decides where OPENAI_API_KEY gets sent in an Authorization
 * header. These tests pin the guard that stops it going somewhere arbitrary.
 */
describe("resolveBaseUrl", () => {
  it("defaults to the OpenAI endpoint", () => {
    expect(resolveBaseUrl(undefined, false)).toBe("https://api.openai.com/v1");
  });

  it("allows known provider hosts", () => {
    expect(resolveBaseUrl("https://openrouter.ai/api/v1", false)).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(resolveBaseUrl("https://api.groq.com/openai/v1", false)).toBe(
      "https://api.groq.com/openai/v1",
    );
  });

  it("allows subdomains of known hosts", () => {
    expect(resolveBaseUrl("https://eu.api.mistral.ai/v1", false)).toBe(
      "https://eu.api.mistral.ai/v1",
    );
  });

  it("rejects an unknown host", () => {
    expect(resolveBaseUrl("https://evil.example.com/v1", false)).toBeNull();
  });

  it("rejects plain http on a remote host", () => {
    expect(resolveBaseUrl("http://api.openai.com/v1", false)).toBeNull();
  });

  it("rejects a malformed url", () => {
    expect(resolveBaseUrl("not-a-url", false)).toBeNull();
  });

  it("rejects a lookalike host", () => {
    expect(resolveBaseUrl("https://api.openai.com.evil.net/v1", false)).toBeNull();
  });

  it("allows loopback for local models over http", () => {
    expect(resolveBaseUrl("http://localhost:11434/v1", false)).toBe(
      "http://localhost:11434/v1",
    );
    expect(resolveBaseUrl("http://127.0.0.1:8080/v1", false)).toBe(
      "http://127.0.0.1:8080/v1",
    );
  });

  it("honours the explicit opt-out for self-hosted endpoints", () => {
    expect(resolveBaseUrl("https://my-llm.internal/v1", true)).toBe(
      "https://my-llm.internal/v1",
    );
  });

  it("still requires https when opted out", () => {
    expect(resolveBaseUrl("http://my-llm.internal/v1", true)).toBeNull();
  });

  it("strips a trailing slash", () => {
    expect(resolveBaseUrl("https://api.openai.com/v1/", false)).toBe(
      "https://api.openai.com/v1",
    );
  });
});
