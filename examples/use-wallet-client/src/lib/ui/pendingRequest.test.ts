import { describe, expect, it } from "vitest";

import { pendingSession } from "../../testing/fixtures.ts";
import { pendingRequestSession } from "./pendingRequest.ts";

describe("pendingRequestSession", () => {
  it("yields the peerless session a connect just parked", () => {
    expect(pendingRequestSession([pendingSession()])?.id).toBe("request-1");
    expect(pendingRequestSession([pendingSession({ status: "connecting" })])?.id).toBe("request-1");
  });

  it("yields nothing once the attempt settled", () => {
    expect(pendingRequestSession([])).toBeNull();
    expect(pendingRequestSession([pendingSession({ status: "disconnected" })])).toBeNull();
    expect(pendingRequestSession([pendingSession({ status: "failed" })])).toBeNull();
    expect(
      pendingRequestSession([pendingSession({ status: "connected", peer: { domains: {} } })]),
    ).toBeNull();
  });

  it("ignores a resume — the session still carries the previous peer", () => {
    expect(
      pendingRequestSession([pendingSession({ status: "connecting", peer: { domains: {} } })]),
    ).toBeNull();
  });

  it("prefers the most recently updated pending request", () => {
    const stale = pendingSession({ id: "stale", updatedAt: 1 });
    const fresh = pendingSession({ id: "fresh", updatedAt: 2 });

    expect(pendingRequestSession([stale, fresh])?.id).toBe("fresh");
  });
});
