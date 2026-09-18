/**
 * Adapts an RTC data channel to the
 * {@link import("@algorandfoundation/connections-core").ConnectionTransport}
 * contract of `connections-core`, so the `ConnectionRpc` layer runs over
 * the negotiated WebRTC channel unchanged.
 */

import type {
  ConnectionTransport,
  ConnectionTransportState,
} from "@algorandfoundation/connections-core";

import type { LiquidDataChannel } from "./signaling.ts";

/** Maps an RTC `readyState` onto the transport contract's states. */
function toTransportState(readyState: string): ConnectionTransportState {
  switch (readyState) {
    case "open":
      return "open";
    case "closing":
    case "closed":
      return "closed";
    default:
      return "connecting";
  }
}

/**
 * Wraps a {@link LiquidDataChannel} as a {@link ConnectionTransport}.
 *
 * Installs the channel's `onmessage`/`onopen`/`onclose` handler slots
 * once and fans out to any number of subscribers; non-string frames are
 * stringified defensively.
 *
 * @param channel - The negotiated RTC data channel (browser or
 * `react-native-webrtc`).
 * @returns The {@link ConnectionTransport} over the channel.
 *
 * @example
 * ```typescript
 * const transport = dataChannelTransport(await client.peer(requestId, "offer"));
 * const rpc = createConnectionRpc(transport);
 * ```
 */
export function dataChannelTransport(channel: LiquidDataChannel): ConnectionTransport {
  const messageListeners = new Set<(data: string) => void>();
  const stateListeners = new Set<(state: ConnectionTransportState) => void>();
  let lastState = toTransportState(channel.readyState);

  const notifyState = (state: ConnectionTransportState): void => {
    if (state === lastState) return;
    lastState = state;
    for (const cb of stateListeners) {
      cb(state);
    }
  };

  channel.onmessage = (event: { data: unknown }): void => {
    const data = typeof event.data === "string" ? event.data : String(event.data);
    for (const cb of messageListeners) {
      cb(data);
    }
  };
  channel.onopen = (): void => {
    notifyState("open");
  };
  channel.onclose = (): void => {
    notifyState("closed");
  };

  return {
    get state(): ConnectionTransportState {
      // Poll the channel so state reads stay truthful even when a host
      // channel implementation skips the handler slots; a locally
      // observed close is sticky.
      return lastState === "closed" ? "closed" : toTransportState(channel.readyState);
    },
    send(data: string): void {
      channel.send(data);
    },
    onMessage(cb: (data: string) => void): () => void {
      messageListeners.add(cb);
      return () => {
        messageListeners.delete(cb);
      };
    },
    onStateChange(cb: (state: ConnectionTransportState) => void): () => void {
      stateListeners.add(cb);
      return () => {
        stateListeners.delete(cb);
      };
    },
    close(): void {
      channel.close();
      notifyState("closed");
    },
  };
}
