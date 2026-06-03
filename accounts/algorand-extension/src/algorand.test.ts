import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubscriberWithWatchlist } from "./algorand.ts";

type BalanceChangeEvent = {
  balanceChanges?: Array<{ address: string; assetId: bigint; amount: bigint }>;
};
type BalanceChangeListener = (event: BalanceChangeEvent) => void | Promise<void>;

type MockSubscriberInstance = {
  pollOnce: ReturnType<typeof vi.fn>;
  emitBalanceChanges: (event: BalanceChangeEvent) => Promise<void>;
};

const subscriberMockState = vi.hoisted(() => ({
  MockAlgorandSubscriber: null as unknown as {
    instances: MockSubscriberInstance[];
  },
}));

vi.mock("@algorandfoundation/algokit-subscriber", () => ({
  AlgorandSubscriber: class {
    static instances: MockSubscriberInstance[] = [];

    readonly pollOnce = vi.fn().mockResolvedValue({});

    private readonly eventListeners = new Map<string, BalanceChangeListener[]>();

    constructor(_config: unknown, _algod: unknown) {
      const MockAlgorandSubscriber = subscriberMockState.MockAlgorandSubscriber;
      MockAlgorandSubscriber.instances.push(this);
    }

    on(eventName: string, listener: BalanceChangeListener): this {
      const listeners = this.eventListeners.get(eventName) ?? [];
      listeners.push(listener);
      this.eventListeners.set(eventName, listeners);
      return this;
    }

    async emitBalanceChanges(event: BalanceChangeEvent): Promise<void> {
      for (const listener of this.eventListeners.get("balance-changes") ?? []) {
        await listener(event);
      }
    }
  },
}));

subscriberMockState.MockAlgorandSubscriber = vi.mocked(
  await import("@algorandfoundation/algokit-subscriber"),
).AlgorandSubscriber as unknown as { instances: MockSubscriberInstance[] };

const makeAlgorandClient = () => ({ client: { algod: {} } }) as any;

describe("createSubscriberWithWatchlist", () => {
  beforeEach(() => {
    subscriberMockState.MockAlgorandSubscriber.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls pollOnce immediately when started", async () => {
    const contained = createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn());
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];

    contained.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(sub.pollOnce).toHaveBeenCalledTimes(1);
  });

  it("polls again after the polling interval on success", async () => {
    const contained = createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn());
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];

    contained.start();
    await vi.advanceTimersByTimeAsync(0); // first poll
    await vi.advanceTimersByTimeAsync(4_000); // second poll after interval

    expect(sub.pollOnce).toHaveBeenCalledTimes(2);
  });

  it("does not poll again after stop is called", async () => {
    const contained = createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn());
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];

    contained.start();
    await vi.advanceTimersByTimeAsync(0); // first poll
    contained.stop("done");
    await vi.advanceTimersByTimeAsync(4_000); // no further polls expected

    expect(sub.pollOnce).toHaveBeenCalledTimes(1);
  });

  it("is a no-op to call start() while already running", async () => {
    const contained = createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn());
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];

    contained.start();
    contained.start(); // second call ignored
    await vi.advanceTimersByTimeAsync(0);

    expect(sub.pollOnce).toHaveBeenCalledTimes(1);
  });

  it("retries after delay when pollOnce throws, up to the max retry count", async () => {
    const onError = vi.fn();
    const contained = createSubscriberWithWatchlist(
      makeAlgorandClient(),
      ["ADDR1"],
      vi.fn(),
      onError,
    );
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];
    const error = new Error("poll failed");
    sub.pollOnce.mockRejectedValue(error);

    contained.start();

    await vi.advanceTimersByTimeAsync(0); // poll #1 — fails, retry 1 scheduled
    await vi.advanceTimersByTimeAsync(2_000); // poll #2 (retry 1) — fails, retry 2 scheduled
    await vi.advanceTimersByTimeAsync(2_000); // poll #3 (retry 2) — fails, retry 3 scheduled
    await vi.advanceTimersByTimeAsync(2_000); // poll #4 (retry 3) — fails, retries exhausted

    expect(sub.pollOnce).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("does not throw when onError is omitted and retries are exhausted", async () => {
    const contained = createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn());
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];
    sub.pollOnce.mockRejectedValue(new Error("boom"));

    contained.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    // No error thrown — reaching this line means the test passes
  });

  it("resets retry count after a successful poll", async () => {
    const onError = vi.fn();
    const contained = createSubscriberWithWatchlist(
      makeAlgorandClient(),
      ["ADDR1"],
      vi.fn(),
      onError,
    );
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];
    const error = new Error("transient");

    // Fail 3 times (up to max retries), then succeed
    sub.pollOnce
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue({});

    contained.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000); // 4th call succeeds — retry count resets

    expect(onError).not.toHaveBeenCalled();

    // Now fail again — should get another full set of retries
    sub.pollOnce.mockRejectedValue(error);
    await vi.advanceTimersByTimeAsync(4_000); // poll after success interval
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("triggers onBalanceChange for matched addresses", async () => {
    const onBalanceChange = vi.fn();
    createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], onBalanceChange);
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];

    await sub.emitBalanceChanges({
      balanceChanges: [{ address: "ADDR1", assetId: 0n, amount: 500n }],
    });

    expect(onBalanceChange).toHaveBeenCalledWith("ADDR1", 0n, 500n);
  });

  it("does not trigger onBalanceChange for unrecognised addresses", async () => {
    const onBalanceChange = vi.fn();
    createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], onBalanceChange);
    const sub = subscriberMockState.MockAlgorandSubscriber.instances[0];

    await sub.emitBalanceChanges({
      balanceChanges: [{ address: "ADDR_OTHER", assetId: 0n, amount: 999n }],
    });

    expect(onBalanceChange).not.toHaveBeenCalled();
  });
});
