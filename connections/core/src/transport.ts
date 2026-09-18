/**
 * An in-memory {@link ConnectionTransport} pair.
 *
 * The reference implementation of the transport contract, used by the
 * package's own tests, the protocol packages' suites, and demos:
 * anywhere both peers of a connection live in the same process.
 */

import type { ConnectionTransport, ConnectionTransportState } from "./types.ts";

/**
 * Both ends of an in-memory transport, already `open` and wired to each
 * other.
 *
 * @example
 * ```typescript
 * const { a, b }: InMemoryTransportPair = createInMemoryTransportPair();
 * ```
 */
export interface InMemoryTransportPair {
  /** One end of the pair (by convention: the dapp/requesting side). */
  a: ConnectionTransport;
  /** The other end of the pair (by convention: the wallet/responding side). */
  b: ConnectionTransport;
}

/** One end's mutable wiring, shared with its peer. */
interface EndState {
  state: ConnectionTransportState;
  messageListeners: Set<(data: string) => void>;
  stateListeners: Set<(state: ConnectionTransportState) => void>;
}

/**
 * Creates an in-memory {@link ConnectionTransport} pair.
 *
 * Frames sent on one end are delivered to the other end's message
 * listeners on a microtask (so subscription order never matters, like a
 * real channel). Closing either end closes both, notifying every state
 * listener exactly once.
 *
 * @returns The {@link InMemoryTransportPair}.
 *
 * @example
 * ```typescript
 * const { a, b } = createInMemoryTransportPair();
 * const dappRpc = createConnectionRpc(a);
 * responder.attach(createConnectionRpc(b));
 * ```
 */
export function createInMemoryTransportPair(): InMemoryTransportPair {
  const makeEnd = (): EndState => ({
    state: "open",
    messageListeners: new Set(),
    stateListeners: new Set(),
  });

  const endA = makeEnd();
  const endB = makeEnd();

  const closeBoth = (): void => {
    for (const end of [endA, endB]) {
      if (end.state === "closed") continue;
      end.state = "closed";
      for (const cb of end.stateListeners) {
        cb("closed");
      }
    }
  };

  const makeTransport = (self: EndState, peer: EndState): ConnectionTransport => ({
    get state(): ConnectionTransportState {
      return self.state;
    },
    send(data: string): void {
      if (self.state !== "open") {
        throw new Error("transport is not open");
      }
      queueMicrotask(() => {
        if (peer.state !== "open") return;
        for (const cb of peer.messageListeners) {
          cb(data);
        }
      });
    },
    onMessage(cb: (data: string) => void): () => void {
      self.messageListeners.add(cb);
      return () => {
        self.messageListeners.delete(cb);
      };
    },
    onStateChange(cb: (state: ConnectionTransportState) => void): () => void {
      self.stateListeners.add(cb);
      return () => {
        self.stateListeners.delete(cb);
      };
    },
    close(): void {
      closeBoth();
    },
  });

  return {
    a: makeTransport(endA, endB),
    b: makeTransport(endB, endA),
  };
}
