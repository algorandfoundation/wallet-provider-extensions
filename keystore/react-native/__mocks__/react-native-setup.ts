import * as crypto from "node:crypto";
import { vi } from "vitest";

// Polyfill global.crypto for @algorandfoundation/wallet-provider generateId()
if (typeof global.crypto === "undefined") {
  // @ts-expect-error
  global.crypto = crypto.webcrypto;
}

vi.mock("react-native-keychain", () => {
  let mockPassword = null;
  return {
    getGenericPassword: vi.fn(async () => mockPassword),
    setGenericPassword: vi.fn(async (username, password) => {
      mockPassword = { username, password };
      return true;
    }),
    resetGenericPassword: vi.fn(async () => {
      mockPassword = null;
    }),
    ACCESS_CONTROL: {
      BIOMETRY_ANY: "BIOMETRY_ANY",
    },
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    },
  };
});
vi.mock("react-native-quick-crypto", () => ({
  ...crypto,
  randomBytes: (size: number) => crypto.randomBytes(size),
}));

vi.mock("react-native-mmkv", () => {
  const mockStorage = new Map();
  const createMock = () => ({
    set: vi.fn((key, value) => mockStorage.set(key, value)),
    getString: vi.fn((key) => mockStorage.get(key)),
    getAllKeys: vi.fn(() => Array.from(mockStorage.keys())),
    delete: vi.fn((key) => mockStorage.delete(key)),
    remove: vi.fn((key) => mockStorage.delete(key)),
    clearAll: vi.fn(() => mockStorage.clear()),
  });
  return {
    MMKV: vi.fn(() => createMock()),
    createMMKV: vi.fn(() => createMock()),
  };
});

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));
