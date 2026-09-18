import { describe, expect, it, vi } from "vitest";

import { createInMemoryTransportPair } from "./transport.ts";

/** Waits for pending microtasks (in-memory delivery is async). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("In-Memory Transport Pair", () => {
  it("starts both ends open and delivers frames to the peer", async () => {
    const { a, b } = createInMemoryTransportPair();
    expect(a.state).toBe("open");
    expect(b.state).toBe("open");

    const received: string[] = [];
    b.onMessage((data) => received.push(data));
    a.send("one");
    a.send("two");
    await flush();

    expect(received).toEqual(["one", "two"]);
  });

  it("does not echo frames back to the sender", async () => {
    const { a, b } = createInMemoryTransportPair();
    const onA = vi.fn();
    a.onMessage(onA);
    b.onMessage(() => {});

    a.send("frame");
    await flush();

    expect(onA).not.toHaveBeenCalled();
  });

  it("closes both ends and notifies state listeners once", async () => {
    const { a, b } = createInMemoryTransportPair();
    const onA = vi.fn();
    const onB = vi.fn();
    a.onStateChange(onA);
    b.onStateChange(onB);

    a.close();
    b.close(); // Idempotent.

    expect(a.state).toBe("closed");
    expect(b.state).toBe("closed");
    expect(onA).toHaveBeenCalledExactlyOnceWith("closed");
    expect(onB).toHaveBeenCalledExactlyOnceWith("closed");
  });

  it("throws when sending on a closed end and drops frames to a closed peer", async () => {
    const { a, b } = createInMemoryTransportPair();
    const received = vi.fn();
    b.onMessage(received);

    a.send("in flight");
    b.close(); // Closes before the microtask delivers.
    await flush();

    expect(received).not.toHaveBeenCalled();
    expect(() => a.send("late")).toThrowError();
  });

  it("stops delivering after unsubscribe", async () => {
    const { a, b } = createInMemoryTransportPair();
    const received = vi.fn();
    const unsubscribe = b.onMessage(received);
    unsubscribe();

    a.send("frame");
    await flush();

    expect(received).not.toHaveBeenCalled();
  });
});
