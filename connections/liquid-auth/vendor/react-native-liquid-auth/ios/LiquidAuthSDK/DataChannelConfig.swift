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
import WebRTC

// MARK: - DataChannelConfig

/// Configuration for a single named data channel.
///
/// This mirrors the `RTCDataChannelInit` options accepted by the JavaScript
/// client's `SignalClient.peer()` (`options.dataChannels`) and the
/// `DataChannelInit` type exposed by `react-native-liquid-auth`, so the same
/// shared shape describes a channel on every platform. All fields are optional;
/// omitted values fall back to the WebRTC defaults.
public struct DataChannelConfig: Sendable, Equatable {
    public var ordered: Bool?
    public var maxRetransmits: Int?
    public var maxPacketLifeTime: Int?
    public var channelProtocol: String?
    public var negotiated: Bool?
    public var channelId: Int?
    /// Creation-order rank (lower first). The channel map crosses the bridge
    /// as an UNORDERED Swift dictionary, but the remote peer observes channels
    /// in creation order and the AC2 agent requires the control channel
    /// (`ac2-v1`) to arrive first — creating in dictionary order made iOS
    /// announce `ac2-heartbeat` first and the agent dropped every session.
    public var order: Int?

    public init(
        ordered: Bool? = nil,
        maxRetransmits: Int? = nil,
        maxPacketLifeTime: Int? = nil,
        channelProtocol: String? = nil,
        negotiated: Bool? = nil,
        channelId: Int? = nil,
        order: Int? = nil
    ) {
        self.ordered = ordered
        self.maxRetransmits = maxRetransmits
        self.maxPacketLifeTime = maxPacketLifeTime
        self.channelProtocol = channelProtocol
        self.negotiated = negotiated
        self.channelId = channelId
        self.order = order
    }

    /// The single `liquid` data channel opened when no channels are supplied,
    /// preserving the previous single-channel behaviour.
    public static let defaultChannels: [String: DataChannelConfig] = ["liquid": DataChannelConfig()]

    /// Build an `RTCDataChannelConfiguration` from this shared shape, applying
    /// only the fields that were explicitly provided.
    func toRTCConfiguration() -> RTCDataChannelConfiguration {
        let config = RTCDataChannelConfiguration()
        if let ordered { config.isOrdered = ordered }
        if let maxRetransmits { config.maxRetransmits = Int32(maxRetransmits) }
        if let maxPacketLifeTime { config.maxPacketLifeTime = Int32(maxPacketLifeTime) }
        if let channelProtocol { config.`protocol` = channelProtocol }
        if let negotiated { config.isNegotiated = negotiated }
        if let channelId { config.channelId = Int32(channelId) }
        return config
    }
}
