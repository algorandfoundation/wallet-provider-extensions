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

// MARK: - LiquidAuthPeerType

/// The type of the *remote* peer we are connecting to.
///
/// This mirrors the `'offer' | 'answer'` union used by the JavaScript client
/// (`@algorandfoundation/liquid-client`) and the `react-native-liquid-auth`
/// binding (`LiquidAuthPeerType`), so the same shared shape describes a peer
/// across every platform. The raw values match the strings emitted on the wire.
///
/// - `answer`: the local device creates the offer (acts as the offerer).
/// - `offer`: the local device waits for the offer and answers it.
public enum LiquidAuthPeerType: String, Sendable, Equatable {
    case offer
    case answer

    /// Parse a wire/string peer type into the shared enum.
    ///
    /// Returns `nil` for any value that is not one of the two known peer types,
    /// so callers can reject malformed input instead of silently guessing.
    public init?(rawString: String) {
        self.init(rawValue: rawString)
    }
}
