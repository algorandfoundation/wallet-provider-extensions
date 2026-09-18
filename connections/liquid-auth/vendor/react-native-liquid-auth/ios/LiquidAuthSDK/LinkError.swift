/*
 * Copyright 2025 Algorand Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation

// MARK: - LinkErrorReason

/// The reason a `link` request was refused by the signaling server.
///
/// Mirrors the `LinkErrorReason` union in the JavaScript client
/// (`@algorandfoundation/liquid-client` `errors.ts`). The raw values match the
/// strings the server sends on the wire.
public enum LinkErrorReason: String, Sendable, Equatable {
    case roomFull = "room-full"
    case duplicateAdmin = "duplicate-admin"
    case duplicatePeer = "duplicate-peer"

    /// Parse a wire/string reason, falling back to `.roomFull` semantics is
    /// intentionally *not* done: unknown reasons return `nil` so callers can
    /// decide how to treat an unrecognised refusal.
    public init?(rawString: String) {
        self.init(rawValue: rawString)
    }
}

// MARK: - LinkError

/// A typed error raised when the signaling server refuses a `link` request
/// (e.g. the room is full or a duplicate peer/admin tried to join).
///
/// Mirrors the `LinkError` class in the JavaScript client so the same shared
/// shape — a `reason` plus the offending `requestId` — describes a refused link
/// on every platform. Callers can fast-fail on this instead of waiting out a
/// negotiation timeout and misclassifying the peer as offline.
public struct LinkError: Error, LocalizedError, Equatable {
    /// The machine-readable refusal reason, when the server supplied a known one.
    public let reason: LinkErrorReason?
    /// The raw reason string as received on the wire (preserved even when it is
    /// not one of the known `LinkErrorReason` cases).
    public let rawReason: String?
    /// The `requestId` the refusal applies to, when provided.
    public let requestId: String?
    /// A human-readable message, when the server supplied one.
    public let message: String?

    public init(
        reason: LinkErrorReason?,
        rawReason: String? = nil,
        requestId: String? = nil,
        message: String? = nil
    ) {
        self.reason = reason
        self.rawReason = rawReason ?? reason?.rawValue
        self.requestId = requestId
        self.message = message
    }

    public var errorDescription: String? {
        if let message, !message.isEmpty {
            return message
        }
        let reasonText = rawReason ?? reason?.rawValue ?? "unknown"
        if let requestId {
            return "Link refused (\(reasonText)) for requestId \(requestId)"
        }
        return "Link refused (\(reasonText))"
    }
}
