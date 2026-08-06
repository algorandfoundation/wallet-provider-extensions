import { describe, expect, it, vi } from "vitest";

import { resolveAuthenticationPrompt, toAuthenticationPrompt } from "./prompts.ts";
import type { AuthenticationOptions } from "./types.ts";

describe("resolveAuthenticationPrompt", () => {
  const defaults: AuthenticationOptions = {
    prompt: "App-wide default",
    prompts: { sign: "Map wording for sign" },
    resolvePrompt: ({ operation }) => (operation === "sign" ? "Formatter wording" : undefined),
  };

  it("prefers a per-call prompt over everything else", () => {
    const prompt = resolveAuthenticationPrompt({ prompt: "Per-call wording" }, defaults, {
      operation: "sign",
    });
    expect(prompt).toEqual({ title: "Per-call wording" });
  });

  it("prefers the formatter over the per-operation map", () => {
    expect(resolveAuthenticationPrompt(undefined, defaults, { operation: "sign" })).toEqual({
      title: "Formatter wording",
    });
  });

  it("falls back to the per-operation map when the formatter returns undefined", () => {
    const options: AuthenticationOptions = { ...defaults, resolvePrompt: () => undefined };
    expect(resolveAuthenticationPrompt(undefined, options, { operation: "sign" })).toEqual({
      title: "Map wording for sign",
    });
  });

  it("falls back to the app-wide prompt when the map has no entry", () => {
    expect(resolveAuthenticationPrompt(undefined, defaults, { operation: "generate" })).toEqual({
      title: "App-wide default",
    });
  });

  it("falls back to the built-in per-operation default when nothing is configured", () => {
    expect(resolveAuthenticationPrompt(undefined, undefined, { operation: "generate" })).toEqual({
      title: "Authenticate to generate a key",
    });
    expect(resolveAuthenticationPrompt(undefined, undefined, { operation: "secret.get" })).toEqual({
      title: "Authenticate to read a secret",
    });
  });

  it("passes the operation, keyId and key metadata to the formatter", () => {
    const resolvePrompt = vi.fn(() => "Sign with your Algorand account");
    const key = { id: "k1", type: "ed25519" } as never;

    const prompt = resolveAuthenticationPrompt({ resolvePrompt }, undefined, {
      operation: "sign",
      keyId: "k1",
      key,
    });

    expect(resolvePrompt).toHaveBeenCalledWith({ operation: "sign", keyId: "k1", key });
    expect(prompt).toEqual({ title: "Sign with your Algorand account" });
  });

  it("passes a prompt object through untouched", () => {
    const prompt = { title: "Unlock", subtitle: "Android only", cancel: "No" };
    expect(resolveAuthenticationPrompt({ prompt }, undefined, { operation: "sign" })).toBe(prompt);
  });

  it("normalizes a bare string and supplies a neutral fallback", () => {
    expect(toAuthenticationPrompt("Hello")).toEqual({ title: "Hello" });
    expect(toAuthenticationPrompt(undefined)).toEqual({
      title: "Authenticate to secure your wallet",
    });
  });
});
