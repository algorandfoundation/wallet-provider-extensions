import { describe, expect, it } from "vitest";

import {
  createFrameDecoder,
  decodeFrame,
  decodeValue,
  encodeFrame,
  encodeValue,
  isRpcMethod,
  type RpcRequest,
} from "./protocol.ts";

describe("remote keystore protocol codec", () => {
  it("round-trips nested Uint8Array payloads through encode/decode", () => {
    const value = {
      id: "abc",
      signature: new Uint8Array([1, 2, 3, 250]),
      nested: [{ bytes: new Uint8Array([0, 255]) }],
      count: 7,
      flag: true,
    };
    const decoded = decodeValue(encodeValue(value)) as typeof value;
    expect(decoded.id).toBe("abc");
    expect(decoded.count).toBe(7);
    expect(decoded.flag).toBe(true);
    expect(Array.from(decoded.signature)).toEqual([1, 2, 3, 250]);
    expect(Array.from(decoded.nested[0].bytes)).toEqual([0, 255]);
  });

  it("survives a JSON round-trip, the way a real transport moves it", () => {
    const encoded = JSON.parse(JSON.stringify(encodeValue({ seed: new Uint8Array(64).fill(7) })));
    const decoded = decodeValue(encoded) as { seed: Uint8Array };
    expect(decoded.seed).toBeInstanceOf(Uint8Array);
    expect(decoded.seed.length).toBe(64);
    expect(decoded.seed.every((byte) => byte === 7)).toBe(true);
  });

  it("encodes bytes without Buffer, so the protocol stays runtime-neutral", () => {
    const encoded = encodeValue(new Uint8Array([1, 2])) as { $bytes: string };
    expect(encoded.$bytes).toBe("AQI=");
  });

  it("frames and reassembles messages split across chunks", () => {
    const request: RpcRequest = { jsonrpc: "2.0", id: 1, method: "state", params: [] };
    const frame = encodeFrame(request);
    const decoder = createFrameDecoder();
    const half = Math.floor(frame.length / 2);
    expect(decoder.push(frame.slice(0, half))).toEqual([]);
    expect(decoder.push(frame.slice(half))).toEqual([request]);
  });

  it("parses a whole frame as a message transport delivers it", () => {
    const request: RpcRequest = { jsonrpc: "2.0", id: 2, method: "sign", params: [] };
    expect(decodeFrame(encodeFrame(request))).toEqual(request);
    expect(decodeFrame("   ")).toBeUndefined();
  });

  it("allow-lists only the keystore surface", () => {
    expect(isRpcMethod("sign")).toBe(true);
    expect(isRpcMethod("secrets.get")).toBe(true);
    expect(isRpcMethod("evalArbitraryCode")).toBe(false);
  });
});
