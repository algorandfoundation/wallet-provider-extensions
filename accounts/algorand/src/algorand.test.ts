import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubscriberWithWatchlist } from "./algorand.ts";

type ErrorListener = (error: unknown) => void | Promise<void>;
type BalanceChangeEvent = {
  balanceChanges?: Array<{ address: string; assetId: bigint; amount: bigint }>;
};
type BalanceChangeListener = (event: BalanceChangeEvent) => void | Promise<void>;

type MockSubscriberInstance = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emitError: (error: unknown) => Promise<void>;
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

    readonly start = vi.fn();
    readonly stop = vi.fn();

    private readonly errorListeners: ErrorListener[] = [];
    private readonly eventListeners = new Map<string, BalanceChangeListener[]>();

    constructor(_config: unknown, _algod: unknown) {
      const MockAlgorandSubscriber = subscriberMockState.MockAlgorandSubscriber;
      MockAlgorandSubscriber.instances.push(this);
    }

    onError(listener: ErrorListener): this {
      this.errorListeners.push(listener);
      return this;
    }

    on(eventName: string, listener: BalanceChangeListener): this {
      const listeners = this.eventListeners.get(eventName) ?? [];
      listeners.push(listener);
      this.eventListeners.set(eventName, listeners);
      return this;
    }

    async emitError(error: unknown): Promise<void> {
      for (const listener of this.errorListeners) {
        await listener(error);
      }
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

const emitErrorAndFlushRetry = async (subscriber: MockSubscriberInstance, error: unknown) => {
  const pending = subscriber.emitError(error);
  await vi.advanceTimersByTimeAsync(2_000);
  await pending;
};

describe("createSubscriberWithWatchlist", () => {
  beforeEach(() => {
    subscriberMockState.MockAlgorandSubscriber.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries subscriber start up to the fixed max before calling onError", async () => {
    const onError = vi.fn();

    createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn(), onError);
    const subscriber = subscriberMockState.MockAlgorandSubscriber.instances[0];
    const error = new Error("boom");

    await emitErrorAndFlushRetry(subscriber, error);
    await emitErrorAndFlushRetry(subscriber, error);
    await emitErrorAndFlushRetry(subscriber, error);

    expect(subscriber.start).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();

    await subscriber.emitError(error);

    expect(subscriber.start).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("resets retry count after a successful balance-change event", async () => {
    const onError = vi.fn();
    const onBalanceChange = vi.fn();

    createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], onBalanceChange, onError);
    const subscriber = subscriberMockState.MockAlgorandSubscriber.instances[0];
    const error = new Error("boom");

    await emitErrorAndFlushRetry(subscriber, error);
    await emitErrorAndFlushRetry(subscriber, error);
    await emitErrorAndFlushRetry(subscriber, error);
    await subscriber.emitError(error);

    expect(onError).toHaveBeenCalledTimes(1);

    await subscriber.emitBalanceChanges({
      balanceChanges: [{ address: "ADDR1", assetId: 0n, amount: 1n }],
    });

    expect(onBalanceChange).toHaveBeenCalledWith("ADDR1", 0n, 1n);

    await emitErrorAndFlushRetry(subscriber, error);

    expect(subscriber.start).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onError is omitted", async () => {
    createSubscriberWithWatchlist(makeAlgorandClient(), ["ADDR1"], vi.fn());
    const subscriber = subscriberMockState.MockAlgorandSubscriber.instances[0];
    const error = new Error("boom");

    await emitErrorAndFlushRetry(subscriber, error);
    await emitErrorAndFlushRetry(subscriber, error);
    await emitErrorAndFlushRetry(subscriber, error);

    await expect(subscriber.emitError(error)).resolves.toBeUndefined();
    expect(subscriber.start).toHaveBeenCalledTimes(3);
  });
});
