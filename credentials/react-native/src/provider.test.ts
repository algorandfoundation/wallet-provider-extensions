import { describe, it, expect, vi } from "vitest";
import {
  DigitalCredentialsUnsupportedError,
  memoryCredentialDriver,
  type DigitalCredentialProviderEntry,
} from "@algorandfoundation/credentials-core";
import { WithCredentials } from "./extension.ts";
import {
  nativeDigitalCredentialsProvider,
  toRegisteredCredential,
  unsupportedDigitalCredentialsProvider,
  type DigitalCredentialsModuleLike,
  type DigitalCredentialsPresentationRequestEvent,
} from "./provider.ts";

type Listener = (event: DigitalCredentialsPresentationRequestEvent) => void;

interface FakeModule extends DigitalCredentialsModuleLike {
  /** Emits an `onPresentationRequest` event to every installed listener. */
  emit(event: Partial<DigitalCredentialsPresentationRequestEvent>): void;
  /** Number of `addListener` subscriptions taken out so far. */
  readonly listenerCount: number;
}

function createFakeModule(supported = true): FakeModule {
  const listeners: Listener[] = [];
  return {
    isSupported: vi.fn(() => supported),
    registerCredentials: vi.fn(async () => {}),
    unregisterCredentials: vi.fn(async () => {}),
    completePresentationRequest: vi.fn(),
    abortPresentationRequest: vi.fn(),
    addListener: vi.fn((_eventName: "onPresentationRequest", listener: Listener) => {
      listeners.push(listener);
      return {
        remove() {
          listeners.splice(listeners.indexOf(listener), 1);
        },
      };
    }),
    emit(event) {
      const full: DigitalCredentialsPresentationRequestEvent = {
        requestId: "req-1",
        protocol: "openid4vp-v1-unsigned",
        dataJson: "{}",
        ...event,
      };
      for (const listener of listeners) listener(full);
    },
    get listenerCount() {
      return listeners.length;
    },
  };
}

const entry: DigitalCredentialProviderEntry = {
  id: "cred-1",
  protocols: ["openid4vp-v1-unsigned"],
  display: { title: "Sample Badge", subtitle: "did:key:z1" },
  metadata: {
    vct: "https://credentials.example/badge",
    claims: [
      { path: ["given_name"], value: "Ada", displayValue: "Ada", selectivelyDisclosable: true },
      { path: ["address", "city"], displayName: "City" },
    ],
  },
};

/** Awaits the microtasks the handler round-trip resolves through. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("toRegisteredCredential", () => {
  it("maps a full provider entry to the native registration shape", () => {
    expect(toRegisteredCredential(entry)).toEqual({
      id: "cred-1",
      format: "dc+sd-jwt",
      vct: "https://credentials.example/badge",
      title: "Sample Badge",
      subtitle: "did:key:z1",
      claims: [
        {
          path: ["given_name"],
          value: "Ada",
          displayName: "given_name",
          displayValue: "Ada",
          selectivelyDisclosable: true,
        },
        { path: ["address", "city"], displayName: "City" },
      ],
    });
  });

  it("returns undefined when metadata.vct is missing", () => {
    expect(toRegisteredCredential({ id: "cred-2", protocols: [] })).toBeUndefined();
    expect(
      toRegisteredCredential({ id: "cred-2", protocols: [], metadata: { claims: [] } }),
    ).toBeUndefined();
  });

  it("defaults a claim displayName to the joined path", () => {
    const registered = toRegisteredCredential({
      id: "cred-3",
      protocols: [],
      metadata: { vct: "vct-3", claims: [{ path: ["address", "city"] }] },
    });

    expect(registered?.claims).toEqual([
      { path: ["address", "city"], displayName: "address.city" },
    ]);
  });

  it("falls back to the entry id for the title and omits an absent subtitle", () => {
    const registered = toRegisteredCredential({
      id: "cred-4",
      protocols: [],
      metadata: { vct: "vct-4" },
    });

    expect(registered?.title).toBe("cred-4");
    expect(registered?.claims).toEqual([]);
    expect(registered && "subtitle" in registered).toBe(false);
  });
});

describe("nativeDigitalCredentialsProvider", () => {
  it("passes isSupported through to the injected module", () => {
    expect(nativeDigitalCredentialsProvider(createFakeModule(true)).isSupported()).toBe(true);
    expect(nativeDigitalCredentialsProvider(createFakeModule(false)).isSupported()).toBe(false);
  });

  it("serializes the mapped entries and skips entries without a vct", async () => {
    const module = createFakeModule();
    const provider = nativeDigitalCredentialsProvider(module);

    await provider.registerCredentials([entry, { id: "no-vct", protocols: [] }]);

    expect(module.registerCredentials).toHaveBeenCalledTimes(1);
    const [entriesJson] = vi.mocked(module.registerCredentials).mock.calls[0]!;
    expect(JSON.parse(entriesJson)).toEqual([toRegisteredCredential(entry)]);
  });

  it("passes unregisterCredentials through to the injected module", async () => {
    const module = createFakeModule();

    await nativeDigitalCredentialsProvider(module).unregisterCredentials();

    expect(module.unregisterCredentials).toHaveBeenCalledTimes(1);
  });

  it("routes a presentation request to the handler and completes the platform flow", async () => {
    const module = createFakeModule();
    const provider = nativeDigitalCredentialsProvider(module);
    const handler = vi.fn(async () => ({
      protocol: "openid4vp-v1-unsigned",
      data: { vp_token: "vp" },
    }));
    provider.setRequestHandler(handler);

    module.emit({
      requestId: "req-42",
      protocol: "openid4vp-v1-unsigned",
      dataJson: JSON.stringify({ dcql_query: { credentials: [] } }),
      origin: "https://verifier.example",
      selectedEntryId: "cred-1",
    });
    await flush();

    expect(handler).toHaveBeenCalledWith({
      protocol: "openid4vp-v1-unsigned",
      data: { dcql_query: { credentials: [] } },
      origin: "https://verifier.example",
      selectedCredentialId: "cred-1",
    });
    expect(module.completePresentationRequest).toHaveBeenCalledWith(
      "req-42",
      JSON.stringify({ protocol: "openid4vp-v1-unsigned", data: { vp_token: "vp" } }),
    );
    expect(module.abortPresentationRequest).not.toHaveBeenCalled();
  });

  it("aborts the platform flow with the message of a rejecting handler", async () => {
    const module = createFakeModule();
    const provider = nativeDigitalCredentialsProvider(module);
    provider.setRequestHandler(async () => {
      throw new Error("user declined the presentation");
    });

    module.emit({ requestId: "req-43" });
    await flush();

    expect(module.abortPresentationRequest).toHaveBeenCalledWith(
      "req-43",
      "user declined the presentation",
    );
    expect(module.completePresentationRequest).not.toHaveBeenCalled();
  });

  it("aborts when an event arrives with no handler installed", async () => {
    const module = createFakeModule();
    const provider = nativeDigitalCredentialsProvider(module);
    // Subscribe, then emit through the listener while no handler is current.
    provider.setRequestHandler(async () => ({ protocol: "p", data: {} }));
    provider.setRequestHandler(undefined as never);

    module.emit({ requestId: "req-44" });
    await flush();

    expect(module.abortPresentationRequest).toHaveBeenCalledWith(
      "req-44",
      expect.stringContaining("setRequestHandler"),
    );
  });

  it("passes a non-JSON payload through to the handler untouched", async () => {
    const module = createFakeModule();
    const provider = nativeDigitalCredentialsProvider(module);
    const handler = vi.fn(async () => ({ protocol: "org-iso-mdoc", data: "raw-response" }));
    provider.setRequestHandler(handler);

    module.emit({ requestId: "req-45", protocol: "org-iso-mdoc", dataJson: "not-json" });
    await flush();

    expect(handler).toHaveBeenCalledWith({ protocol: "org-iso-mdoc", data: "not-json" });
  });

  it("swaps the handler on re-set without adding a second subscription", async () => {
    const module = createFakeModule();
    const provider = nativeDigitalCredentialsProvider(module);
    const first = vi.fn(async () => ({ protocol: "p", data: 1 }));
    const second = vi.fn(async () => ({ protocol: "p", data: 2 }));

    provider.setRequestHandler(first);
    provider.setRequestHandler(second);
    module.emit({ requestId: "req-46" });
    await flush();

    expect(module.addListener).toHaveBeenCalledTimes(1);
    expect(module.listenerCount).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(module.completePresentationRequest).toHaveBeenCalledTimes(1);
  });

  it("subscribes only when a handler is installed", () => {
    const module = createFakeModule();

    nativeDigitalCredentialsProvider(module);

    expect(module.addListener).not.toHaveBeenCalled();
  });
});

describe("unsupportedDigitalCredentialsProvider", () => {
  const provider = unsupportedDigitalCredentialsProvider("no native module");

  it("reports unsupported", () => {
    expect(provider.isSupported()).toBe(false);
  });

  it("rejects registerCredentials with DigitalCredentialsUnsupportedError", async () => {
    const error = await provider.registerCredentials([entry]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DigitalCredentialsUnsupportedError);
    expect((error as DigitalCredentialsUnsupportedError).platform).toBe("react-native");
    expect((error as DigitalCredentialsUnsupportedError).reason).toBe("no native module");
  });

  it("rejects unregisterCredentials with DigitalCredentialsUnsupportedError", async () => {
    await expect(provider.unregisterCredentials()).rejects.toBeInstanceOf(
      DigitalCredentialsUnsupportedError,
    );
  });

  it("does not throw from setRequestHandler", () => {
    expect(() =>
      provider.setRequestHandler(async () => ({ protocol: "p", data: {} })),
    ).not.toThrow();
  });
});

describe("WithCredentials (digital credentials provider seam)", () => {
  it("backs digitalProvider with an injected native module", async () => {
    const module = createFakeModule();
    const extension = WithCredentials({} as any, {
      credentials: { driver: memoryCredentialDriver(), digitalCredentialsModule: module },
    });

    expect(extension.credential.digitalProvider.isSupported()).toBe(true);
    await extension.credential.digitalProvider.registerCredentials([entry]);
    expect(module.registerCredentials).toHaveBeenCalledTimes(1);
  });

  it("attaches the unsupported provider without a native module", async () => {
    const extension = WithCredentials({} as any, {
      credentials: { driver: memoryCredentialDriver() },
    });

    expect(extension.credential.digitalProvider).toBeDefined();
    expect(extension.credential.digitalProvider.isSupported()).toBe(false);
    await expect(
      extension.credential.digitalProvider.registerCredentials([entry]),
    ).rejects.toBeInstanceOf(DigitalCredentialsUnsupportedError);
  });
});
