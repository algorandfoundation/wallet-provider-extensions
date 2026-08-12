import { describe, expect, it } from "vitest";
import { SecretNotFoundError, SecretScratchDisposedError } from "./errors.ts";
import { createSecretScratch } from "./secrets.ts";

describe("createSecretScratch", () => {
  it("lends stored bytes to `use` without copying them", async () => {
    const { scratch } = createSecretScratch();
    const bytes = new Uint8Array([1, 2, 3]);
    scratch.put("seed", bytes);

    const seen = await scratch.use("seed", (value) => value);

    expect(seen).toBe(bytes);
    expect(scratch.has("seed")).toBe(true);
  });

  it("supports an async consumer in `use`", async () => {
    const { scratch } = createSecretScratch();
    scratch.put("seed", new Uint8Array([9]));

    const result = await scratch.use("seed", async (value) => value.length);

    expect(result).toBe(1);
  });

  it("keeps the entry live after `use` returns", async () => {
    const { scratch } = createSecretScratch();
    scratch.put("seed", new Uint8Array([1]));

    await scratch.use("seed", () => undefined);

    expect(scratch.has("seed")).toBe(true);
  });

  it("zeroes the caller's buffer on wipe", () => {
    const { scratch } = createSecretScratch();
    const bytes = new Uint8Array([1, 2, 3]);
    scratch.put("seed", bytes);

    scratch.wipe("seed");

    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    expect(scratch.has("seed")).toBe(false);
  });

  it("zeroes a replaced buffer when the same label is put twice", () => {
    const { scratch } = createSecretScratch();
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5, 6]);
    scratch.put("seed", first);

    scratch.put("seed", second);

    expect(Array.from(first)).toEqual([0, 0, 0]);
    expect(Array.from(second)).toEqual([4, 5, 6]);
  });

  it("treats wiping an unknown label as a no-op", () => {
    const { scratch } = createSecretScratch();
    expect(() => scratch.wipe("nothing")).not.toThrow();
  });

  it("throws SecretNotFoundError when using an unknown label", async () => {
    const { scratch } = createSecretScratch();
    await expect(scratch.use("nothing", (v) => v)).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it("zeroes every buffer on wipeAll", () => {
    const { scratch, wipeAll } = createSecretScratch();
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    scratch.put("a", a);
    scratch.put("b", b);

    wipeAll();

    expect(Array.from(a)).toEqual([0, 0]);
    expect(Array.from(b)).toEqual([0, 0]);
  });

  it("throws SecretScratchDisposedError on any use after wipeAll", async () => {
    const { scratch, wipeAll } = createSecretScratch();
    scratch.put("seed", new Uint8Array([1]));
    wipeAll();

    await expect(scratch.use("seed", (v) => v)).rejects.toBeInstanceOf(SecretScratchDisposedError);
    expect(() => scratch.put("seed", new Uint8Array([1]))).toThrow(SecretScratchDisposedError);
    expect(() => scratch.has("seed")).toThrow(SecretScratchDisposedError);
    expect(() => scratch.wipe("seed")).toThrow(SecretScratchDisposedError);
  });

  it("is idempotent on repeated wipeAll", () => {
    const { wipeAll } = createSecretScratch();
    wipeAll();
    expect(() => wipeAll()).not.toThrow();
  });

  it("redacts material from JSON.stringify", () => {
    const { scratch } = createSecretScratch();
    scratch.put("seed", new Uint8Array([222, 173, 190, 239]));

    expect(JSON.stringify({ secrets: scratch })).toBe('{"secrets":"[SecretScratch]"}');
  });
});
