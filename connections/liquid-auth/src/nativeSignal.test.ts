import { describe, expect, it } from "vitest";
import { defaultNativeSignalModule, nativeSignalClientFactory } from "./nativeModule.ts";
import {
  createNativeSignalClientFactory,
  nativeServiceChannel,
  type NativeSignalModuleLike,
} from "./nativeSignal.ts";

/** A scriptable in-memory double of the native module surface. */
function fakeModule() {
  const messageListeners = new Set<(event: { channel: string; message: string }) => void>();
  const stateListeners = new Set<(event: { channel: string; state: string | null }) => void>();
  const connectionListeners = new Set<(event: { state: string }) => void>();
  const calls: string[] = [];
  const module: NativeSignalModuleLike = {
    async start(url: string): Promise<void> {
      calls.push(`start:${url}`);
    },
    async connect(requestId: string, type: "offer" | "answer"): Promise<void> {
      calls.push(`connect:${requestId}:${type}`);
    },
    send(message: string): void {
      calls.push(`send:${message}`);
    },
    sendToChannel(channel: string, message: string): void {
      calls.push(`sendToChannel:${channel}:${message}`);
    },
    addMessageListener(listener) {
      messageListeners.add(listener);
      return { remove: () => messageListeners.delete(listener) };
    },
    addStateChangeListener(listener) {
      stateListeners.add(listener);
      return { remove: () => stateListeners.delete(listener) };
    },
    addConnectionStateListener(listener) {
      connectionListeners.add(listener);
      return { remove: () => connectionListeners.delete(listener) };
    },
    async disconnect(): Promise<void> {
      calls.push("disconnect");
    },
  };
  return {
    module,
    calls,
    emitMessage: (event: { channel: string; message: string }) =>
      messageListeners.forEach((l) => l(event)),
    emitState: (event: { channel: string; state: string | null }) =>
      stateListeners.forEach((l) => l(event)),
    emitConnectionState: (event: { state: string }) => connectionListeners.forEach((l) => l(event)),
    listenerCount: () => messageListeners.size + stateListeners.size + connectionListeners.size,
  };
}

describe("nativeServiceChannel", () => {
  it("delivers messages and state flips for its own label only", () => {
    const fake = fakeModule();
    const { channel } = nativeServiceChannel(fake.module, "liquid", "CONNECTING");

    const received: unknown[] = [];
    let opened = 0;
    channel.onmessage = (event) => received.push(event.data);
    channel.onopen = () => opened++;

    fake.emitState({ channel: "other", state: "OPEN" });
    expect(channel.readyState).toBe("connecting");

    fake.emitState({ channel: "liquid", state: "OPEN" });
    expect(channel.readyState).toBe("open");
    expect(opened).toBe(1);

    fake.emitMessage({ channel: "other", message: "not-mine" });
    fake.emitMessage({ channel: "liquid", message: "hello" });
    expect(received).toEqual(["hello"]);
  });

  it("routes send through the named channel when not primary", () => {
    const fake = fakeModule();
    const primary = nativeServiceChannel(fake.module, "liquid").channel;
    const named = nativeServiceChannel(fake.module, "ac2-v1").channel;

    primary.send("a");
    named.send("b");
    expect(fake.calls).toEqual(["send:a", "sendToChannel:ac2-v1:b"]);
  });

  it("closes locally on ICE disconnect without stopping the service", () => {
    const fake = fakeModule();
    const { channel } = nativeServiceChannel(fake.module, "liquid", "OPEN");
    let closed = 0;
    channel.onclose = () => closed++;

    fake.emitConnectionState({ state: "DISCONNECTED" });
    expect(channel.readyState).toBe("closed");
    expect(closed).toBe(1);
    expect(fake.calls).not.toContain("disconnect");
  });

  it("discard() closes locally and removes the module listeners", () => {
    const fake = fakeModule();
    const bound = nativeServiceChannel(fake.module, "liquid", "OPEN");
    let closed = 0;
    bound.channel.onclose = () => closed++;

    bound.discard();
    expect(closed).toBe(1);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.calls).not.toContain("disconnect");
  });
});

describe("createNativeSignalClientFactory", () => {
  it("starts the service and negotiates the peer with the forwarded ICE servers", async () => {
    const fake = fakeModule();
    const client = createNativeSignalClientFactory(fake.module)("https://signal.example");

    const channel = await client.peer("req-1", "answer", { iceServers: [{ urls: "stun:s" }] });
    expect(channel.label).toBe("liquid");
    expect(fake.calls).toEqual(["start:https://signal.example", "connect:req-1:answer"]);
  });

  it("retires the previous negotiation's adapter when a fresh peer() binds", async () => {
    const fake = fakeModule();
    const factory = createNativeSignalClientFactory(fake.module);
    const first = factory("https://signal.example");
    const firstChannel = await first.peer("req-1", "answer");
    let firstClosed = 0;
    firstChannel.onclose = () => firstClosed++;

    const second = factory("https://signal.example");
    await second.peer("req-2", "answer");

    // The stale adapter closed locally and stopped listening; the fresh
    // adapter is the only subscriber left.
    expect(firstClosed).toBe(1);
    expect(fake.listenerCount()).toBe(3);
    expect(fake.calls).not.toContain("disconnect");
  });

  it("attestation() throws — authentication is a native concern", async () => {
    const fake = fakeModule();
    const client = createNativeSignalClientFactory(fake.module)("https://signal.example");
    await expect(client.attestation(async () => ({}))).rejects.toThrow(/natively/);
  });

  it("close(true) detaches and stops the native service", async () => {
    const fake = fakeModule();
    const client = createNativeSignalClientFactory(fake.module)("https://signal.example");
    await client.peer("req-1", "answer");

    client.close(true);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.calls).toContain("disconnect");
  });
});

describe("nativeModule seam (Node runtime)", () => {
  it("degrades to undefined when the native module cannot load", () => {
    expect(defaultNativeSignalModule()).toBeUndefined();
  });

  it("the prewired factory reports the unavailable module descriptively", () => {
    expect(() => nativeSignalClientFactory()).toThrow(/react-native-liquid-auth/);
  });
});
