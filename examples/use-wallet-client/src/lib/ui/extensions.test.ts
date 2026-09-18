import { describe, expect, it } from "vitest";

import { Provider } from "@algorandfoundation/wallet-provider";
import { WithAccounts } from "@algorandfoundation/accounts";
import { WithIdentities } from "@algorandfoundation/identities";

import { adoptedExtensions, EXTENSION_NAMESPACES } from "./extensions.ts";

describe("adoptedExtensions", () => {
  it("infers nothing from a bare provider", () => {
    const bare = new Provider({ id: "bare", name: "Bare Provider" });

    expect(adoptedExtensions(bare).size).toBe(0);
  });

  it("infers exactly the extensions a provider actually adopted", () => {
    // A REAL provider composed with a subset of the real extensions:
    // the inference must reflect what the constructor installed, with
    // no hard-coded knowledge of this demo's DappProvider.
    const PartialProvider = Provider.withExtensions([WithAccounts, WithIdentities] as const);
    const partial = new PartialProvider({ id: "partial", name: "Partial Provider" });

    const adopted = adoptedExtensions(partial);

    expect(adopted.has("WithAccounts")).toBe(true);
    expect(adopted.has("WithIdentities")).toBe(true);
    expect(adopted.has("WithConnections")).toBe(false);
    expect(adopted.has("WithCredentials")).toBe(false);
    expect(adopted.has("WithPasskeys")).toBe(false);
    expect(adopted.has("WithKeyStore")).toBe(false);
  });

  it("probes the namespaced API each extension installs, not static declarations", () => {
    // The runtime evidence of adoption is the installed namespace; an
    // object that merely LOOKS like a provider counts once the APIs are
    // present, which is exactly what lets the page stay decoupled from
    // any concrete Provider subclass.
    const duck = { connection: {}, key: {} };

    const adopted = adoptedExtensions(duck);

    expect([...adopted].sort()).toEqual(["WithConnections", "WithKeyStore"]);
  });

  it("treats a nulled-out namespace as not adopted", () => {
    // `declare`-style fields or failed installs leave the namespace
    // undefined/null, and that must not read as an adoption.
    const halfBaked = { connection: undefined, account: null, identity: {} };

    const adopted = adoptedExtensions(halfBaked);

    expect([...adopted]).toEqual(["WithIdentities"]);
  });

  it("knows a namespace for every extension this demo renders a domain for", () => {
    expect(Object.keys(EXTENSION_NAMESPACES).sort()).toEqual([
      "WithAccounts",
      "WithConnections",
      "WithCredentials",
      "WithIdentities",
      "WithKeyStore",
      "WithPasskeys",
    ]);
  });
});
