import "./style.css";

import { Provider } from "@algorandfoundation/wallet-provider";
import { WithKeyStore } from "@algorandfoundation/keystore-web";
import type { Key, KeyStoreCapability, KeyStoreState } from "@algorandfoundation/keystore-web";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";

import {
  bytesToHex,
  createWalletSeed,
  deriveAccountKey,
  formatKeyData,
  generateFalconKey,
  isFalconAvailable,
  nextAccountIndex,
} from "./keystore.ts";

/**
 * Web Keystore Example.
 *
 * A small, framework-free demo of the browser keystore extension. It composes a
 * {@link Provider} with the {@link WithKeyStore} extension, discovers the active
 * cryptographic capabilities, and offers a hierarchical (BIP32-Ed25519) wallet
 * flow alongside a post-quantum Falcon-1024 key — with per-key sign, export and
 * remove. All keystore orchestration lives in `./keystore.ts`; this file only
 * wires the DOM and renders reactive state.
 */

// --- Provider wiring -------------------------------------------------------

/** Reactive state store — the single source of truth for the rendered UI. */
const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });

/** Hook collection for intercepting keystore operations. */
const hooks = new Hook.Collection();

/** The Wallet Provider composed with the browser keystore extension. */
const WebProvider = Provider.withExtensions([WithKeyStore]);

/** Concrete provider instance wired with the reactive store and hooks. */
const provider = new WebProvider(
  { id: "web-keystore-example", name: "Web Keystore Example" },
  { keystore: { store, hooks } },
);

// --- DOM references --------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = $("status");
const capabilitiesEl = $("capabilities");
const keysListEl = $("keys-list");
const consoleEl = $<HTMLPreElement>("console");

const createSeedBtn = $<HTMLButtonElement>("create-seed");
const generateAccountBtn = $<HTMLButtonElement>("generate-account");
const generateFalconBtn = $<HTMLButtonElement>("generate-falcon");
const clearBtn = $<HTMLButtonElement>("clear");

/** Appends a timestamped line to the on-page console. */
function log(message: string): void {
  const time = new Date().toLocaleTimeString();
  consoleEl.textContent = `[${time}] ${message}\n${consoleEl.textContent}`;
}

// --- Rendering -------------------------------------------------------------

/** A human-friendly label + badge class for a key's type. */
function describeType(type: string): { label: string; badge: string } {
  switch (type) {
    case "seed":
      return { label: "Seed", badge: "" };
    case "hd-root-key":
      return { label: "HD Root", badge: "hd" };
    case "hd-derived-ed25519":
      return { label: "Account (Ed25519)", badge: "hd" };
    case "falcon-1024":
      return { label: "Falcon-1024", badge: "falcon" };
    default:
      return { label: type, badge: "" };
  }
}

/** Renders the capability chips grouped visually by source. */
function renderCapabilities(algorithms: KeyStoreCapability[]): void {
  capabilitiesEl.innerHTML = "";
  if (algorithms.length === 0) {
    capabilitiesEl.innerHTML = `<span class="empty">No capabilities reported yet.</span>`;
    return;
  }
  for (const cap of algorithms) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.source = cap.source;
    chip.innerHTML = `${cap.algorithm}<span class="tag">${cap.source}</span>`;
    capabilitiesEl.appendChild(chip);
  }
}

/** Renders one key card, including its available per-key actions. */
function renderKey(key: Key): HTMLLIElement {
  const { label, badge } = describeType(key.type);
  const name = (key.metadata?.name as string) || label;

  const li = document.createElement("li");
  li.className = "key";
  li.innerHTML = `
    <div class="key-head">
      <span class="key-name">${name}</span>
      <span class="badge ${badge}">${label}</span>
    </div>
    <div class="key-id">${key.id}</div>
    <div class="key-actions"></div>
  `;

  const actions = li.querySelector<HTMLDivElement>(".key-actions")!;

  if (key.keyUsages?.includes("sign")) {
    const signBtn = document.createElement("button");
    signBtn.className = "small";
    signBtn.textContent = "Sign & verify";
    signBtn.addEventListener("click", () => void signKey(key));
    actions.appendChild(signBtn);
  }

  if (key.extractable) {
    const exportBtn = document.createElement("button");
    exportBtn.className = "small ghost";
    exportBtn.textContent = "Export";
    exportBtn.addEventListener("click", () => void exportKey(key));
    actions.appendChild(exportBtn);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "small danger";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => void removeKey(key));
  actions.appendChild(removeBtn);

  return li;
}

/** Re-renders the whole UI from the current reactive state. */
function render(): void {
  const status = provider.status;
  statusEl.textContent = status;
  statusEl.dataset.status = status;

  const algorithms = provider.algorithms as KeyStoreCapability[];
  renderCapabilities(algorithms);

  const keys = provider.keys as Key[];
  keysListEl.innerHTML = "";
  if (keys.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No keys yet — create a wallet seed to get started.";
    keysListEl.appendChild(empty);
  } else {
    for (const key of keys) keysListEl.appendChild(renderKey(key));
  }

  // Enable/disable top-level actions based on what the current state allows.
  const busy = status !== "idle";
  const hasSeed = keys.some((k) => k.type === "seed");
  const hasRoot = keys.some((k) => k.type === "hd-root-key");

  createSeedBtn.disabled = busy;
  generateAccountBtn.disabled = busy || !hasRoot;
  generateFalconBtn.disabled = busy || !hasSeed || !isFalconAvailable(algorithms);
  clearBtn.disabled = busy || keys.length === 0;
}

// --- Actions ---------------------------------------------------------------

/**
 * Wraps an async action with error reporting and a final re-render, so button
 * handlers stay tiny and consistent.
 */
async function run(label: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${label} failed: ${message}`);
    console.error(error);
  } finally {
    render();
  }
}

createSeedBtn.addEventListener("click", () =>
  run("Create wallet seed", async () => {
    const { rootKeyId, mnemonic } = await createWalletSeed(provider.key.store);
    log(`Created wallet seed and HD root key ${rootKeyId}.`);
    log(`Recovery phrase (shown once — store it safely):\n${mnemonic}`);
  }),
);

generateAccountBtn.addEventListener("click", () =>
  run("Derive account", async () => {
    const keys = provider.keys as Key[];
    const root = keys.find((k) => k.type === "hd-root-key");
    if (!root) {
      log("Create a wallet seed first.");
      return;
    }
    const index = nextAccountIndex(keys, root.id);
    const id = await deriveAccountKey(provider.key.store, { rootKeyId: root.id, index });
    log(`Derived account #${index} (${id}).`);
  }),
);

generateFalconBtn.addEventListener("click", () =>
  run("Generate Falcon key", async () => {
    const keys = provider.keys as Key[];
    const seed = keys.find((k) => k.type === "seed");
    if (!seed) {
      log("Create a wallet seed first.");
      return;
    }
    const id = await generateFalconKey(provider.key.store, seed.id);
    log(`Generated post-quantum Falcon-1024 key ${id}.`);
  }),
);

clearBtn.addEventListener("click", () =>
  run("Clear all", async () => {
    await provider.key.store.clear?.();
    log("Cleared all keys.");
  }),
);

/** Signs a short demo message with the key and verifies the signature. */
function signKey(key: Key): Promise<void> {
  return run("Sign", async () => {
    const message = new TextEncoder().encode("hello from the web keystore");
    const signature = await provider.key.store.sign(key.id, message);
    const valid = await provider.key.store.verify(key.id, message, signature);
    log(`Signed with ${key.id}\nsignature: ${bytesToHex(signature)}\nverified: ${valid}`);
  });
}

/** Exports an extractable key's public data and prints it to the console. */
function exportKey(key: Key): Promise<void> {
  return run("Export", async () => {
    const data = await provider.key.store.export(key.id);
    log(`Exported ${key.id}:\n${formatKeyData(data)}`);
  });
}

/** Removes a key from the keystore. */
function removeKey(key: Key): Promise<void> {
  return run("Remove", async () => {
    await provider.key.store.remove(key.id);
    log(`Removed ${key.id}.`);
  });
}

// --- Bootstrap -------------------------------------------------------------

// Re-render whenever the reactive keystore state changes.
store.subscribe(render);

/**
 * Waits for the keystore to be ready (IndexedDB open, shims layered, metadata
 * hydrated), then performs the first render.
 */
async function init(): Promise<void> {
  statusEl.textContent = "initializing";
  try {
    await provider.key.store.ready;
    log("Keystore ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusEl.textContent = "error";
    log(`Failed to initialize keystore: ${message}`);
    console.error(error);
  } finally {
    render();
  }
}

void init();
