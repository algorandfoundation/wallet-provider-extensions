import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";

/**
 * The `options.log` namespace {@link WithLogs} claims on the shared
 * {@link ExtensionOptions} registry.
 *
 * Packages layering on top of the log (e.g. a remote telemetry sink) augment
 * this interface to add their own fields, so composition roots keep a single
 * typed `options.log` block.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/logs" {
 *   interface LogNamespace {
 *     endpoint?: string;
 *   }
 * }
 * ```
 */
export interface LogNamespace {
  /** The reactive store backing the log; a new empty store is created when omitted. */
  store?: Store<LogStoreState>;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Log-specific settings, see {@link LogNamespace}. */
    log?: LogNamespace;
  }
}

/**
 * Configuration for the log store extension.
 *
 * The extension works with zero configuration: a fresh in-memory store is
 * created when none is provided. Supply a store to share log state across
 * providers or to subscribe to it from application code.
 */
export interface LogStoreOptions extends ExtensionOptions {
  /** Log-specific settings. */
  log?: LogNamespace;
}

/**
 * The state of the log store.
 */
export interface LogStoreState {
  /** Newest-first list of recorded {@link LogMessage | log messages}. */
  logs: LogMessage[];
}

/**
 * Severity of a {@link LogMessage}. Each level maps onto the `console` method
 * of the same name.
 */
export type LogLevel = "info" | "warn" | "error" | "debug" | "trace";

/**
 * Represents a log message.
 */
export interface LogMessage {
  /**
   * A unique identifier for the log entry.
   */
  id: string;
  /**
   * The context of the log entry (e.g., '@algorandfoundation/react-native-provider', '@algorandfoundation/key-store').
   */
  context?: string;
  /**
   * The timestamp of the log entry.
   */
  timestamp: Date;
  /**
   * The level of the log entry (e.g., 'info', 'warn', 'error').
   */
  level: LogLevel;
  /**
   * The message content.
   */
  message: string;
  /**
   * Additional metadata associated with the log entry.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a log store interface for managing logs.
 */
export interface LogStoreExtension extends LogStoreState {
  /**
   * An object that represents additional functionality provided by this extension.
   */
  log: LogStoreApi;
}

/**
 * Signature shared by every level method on {@link LogStoreApi}.
 *
 * @param message - The human-readable message.
 * @param metadata - Structured data recorded on the entry (e.g. `account`, `requestId`).
 * @param context - Optional origin label (typically the emitting package or extension).
 */
export type LogFn = (message: string, metadata?: Record<string, unknown>, context?: string) => void;

/**
 * Interface representing a LogStore extension API.
 *
 * @example
 * ```typescript
 * provider.log.info("Signed transaction", { txId }, "@algorandfoundation/keystore");
 * ```
 */
export interface LogStoreApi {
  /** Records an `info` entry. */
  info: LogFn;
  /** Records a `warn` entry. */
  warn: LogFn;
  /** Records an `error` entry. */
  error: LogFn;
  /** Records a `debug` entry. */
  debug: LogFn;
  /** Records a `trace` entry. */
  trace: LogFn;
  /**
   * Clears all log entries.
   */
  clear: () => void;
}
