/**
 * An in-memory mock of the Liquid Auth signaling service.
 *
 * The counterpart of `createInMemoryTransportPair` one layer down: both
 * peers build their {@link LiquidSignalClient} from
 * {@link MockSignalingHub.createSignalClient}, and a room "connects"
 * once one side joined as `offer` and the other as `answer`; each side
 * resolves with its end of an in-memory data channel pair. Rooms are
 * re-creatable: after a pair connected (and possibly closed), a second
 * `offer`/`answer` rendezvous on the same `requestId` pairs again,
 * mirroring the resume path of the real signaling service. Used by this
 * package's tests and by downstream engine/adapter suites; never by
 * production code.
 */

import type { LiquidDataChannel, LiquidSignalClient } from "./signaling.ts";

/** One end of an in-memory RTC-shaped data channel pair. */
export class MockDataChannel implements LiquidDataChannel {
  readyState: string = "open";
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  /** The other end of the pair. */
  peer: MockDataChannel | undefined;

  send(data: string): void {
    if (this.readyState !== "open") {
      throw new Error("mock data channel is not open");
    }
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer && peer.readyState === "open") {
        peer.onmessage?.({ data });
      }
    });
  }

  close(): void {
    for (const end of [this, this.peer]) {
      if (!end || end.readyState === "closed") continue;
      end.readyState = "closed";
      end.onclose?.();
    }
  }
}

/** Creates an open in-memory {@link MockDataChannel} pair. */
export function createMockChannelPair(): { a: MockDataChannel; b: MockDataChannel } {
  const a = new MockDataChannel();
  const b = new MockDataChannel();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

/** A pending `peer()` call parked in a signaling room. */
interface RoomWaiter {
  resolve: (channel: LiquidDataChannel) => void;
  reject: (error: unknown) => void;
}

/** The mock client returned by {@link MockSignalingHub.createSignalClient}. */
export interface MockSignalClient extends LiquidSignalClient {
  /** The signaling origin the client was created for. */
  url: string;
  /** The liquid-extension payload the last attestation produced. */
  lastAttestation?: Record<string, unknown>;
  /** Whether `close()` was called. */
  closed: boolean;
}

/**
 * The in-memory signaling hub shared by both peers of a test.
 */
export interface MockSignalingHub {
  /** Builds a {@link MockSignalClient} bound to this hub. */
  createSignalClient(url: string): MockSignalClient;
  /** Every client the hub created, in creation order. */
  clients: MockSignalClient[];
  /** Rejects all pending peers of a room (simulates a signaling failure). */
  failRoom(requestId: string, error?: unknown): void;
}

/**
 * Creates a {@link MockSignalingHub}.
 *
 * @param options - `attestationError` makes every attestation reject
 * (simulates a service refusing the wallet's registration).
 */
export function createMockSignaling(
  options: { attestationError?: unknown } = {},
): MockSignalingHub {
  const rooms = new Map<string, { offer?: RoomWaiter; answer?: RoomWaiter }>();
  const clients: MockSignalClient[] = [];

  const joinRoom = (requestId: string, type: "offer" | "answer"): Promise<LiquidDataChannel> => {
    return new Promise<LiquidDataChannel>((resolve, reject) => {
      const room = rooms.get(requestId) ?? {};
      room[type] = { resolve, reject };
      rooms.set(requestId, room);
      if (room.offer && room.answer) {
        const { a, b } = createMockChannelPair();
        room.offer.resolve(a);
        room.answer.resolve(b);
        rooms.delete(requestId);
      }
    });
  };

  return {
    clients,
    createSignalClient(url: string): MockSignalClient {
      const client: MockSignalClient = {
        url,
        authenticated: false,
        closed: false,
        peer(requestId: string, type: "offer" | "answer"): Promise<LiquidDataChannel> {
          return joinRoom(requestId, type);
        },
        async attestation(
          onChallenge: (challenge: Uint8Array) => Promise<Record<string, unknown>>,
        ): Promise<unknown> {
          if (options.attestationError !== undefined) {
            throw options.attestationError;
          }
          client.lastAttestation = await onChallenge(new Uint8Array(32));
          client.authenticated = true;
          return { id: "user", wallet: "", credentials: [] };
        },
        close(): void {
          client.closed = true;
        },
      };
      clients.push(client);
      return client;
    },
    failRoom(requestId: string, error: unknown = new Error("signaling failed")): void {
      const room = rooms.get(requestId);
      if (!room) return;
      room.offer?.reject(error);
      room.answer?.reject(error);
      rooms.delete(requestId);
    },
  };
}
