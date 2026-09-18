import ExpoModulesCore
import WebRTC

/**
 * iOS bindings for the Liquid Auth signaling service.
 *
 * Wraps the bundled `LiquidAuthSDK` signaling stack (ported from
 * `liquid-auth-ios`) so wallets can drive the WebRTC
 * signaling handshake from JavaScript. This mirrors the Android module's JS
 * contract: `start`/`connect`/`cancel`/`send`/`sendToChannel`/`disconnect`
 * plus the `onMessage`/`onStateChange`/`onTrack`/`onPresence`/`onLinkError`/
 * `onConnectionStateChange` events.
 *
 * Unlike Android there is no foreground `Service`; the shared
 * `SignalService.shared` singleton owns the connection. Long-lived background
 * execution on iOS is subject to platform constraints (see the consolidation
 * plan's Phase 3 open question).
 */
public class LiquidAuthNativeModule: Module {
  /// The signaling origin captured from `start(url:)`, reused as the
  /// `connectToPeer` origin (iOS re-creates the socket per negotiation).
  private var signalUrl: String?
  /// The in-flight `connect` promise, resolved when the first channel opens and
  /// rejected on link-error/abort. Only one negotiation is tracked at a time.
  private var pendingConnect: Promise?

  public func definition() -> ModuleDefinition {
    Name("LiquidAuthNative")

    Events(
      "onMessage",
      "onStateChange",
      "onTrack",
      "onPresence",
      "onLinkError",
      "onConnectionStateChange",
      "onSignalingStateChange"
    )

    /**
     * Generate a random request id.
     */
    Function("generateRequestId") { () -> String in
      UUID().uuidString
    }

    /**
     * Parse a `liquid://<origin>/?requestId=<id>` URI into its `origin` and
     * `requestId` parts.
     */
    Function("parseMessage") { (value: String) -> [String: String] in
      guard let parsed = Self.parseLiquidUri(value) else {
        throw NSError(
          domain: "LiquidAuthNative",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Invalid Liquid Auth URI: \(value)"]
        )
      }
      return ["origin": parsed.origin, "requestId": parsed.requestId]
    }

    /**
     * Start the signaling service and connect the signaling client to the given
     * origin. The origin is reused by `connect`.
     */
    AsyncFunction("start") { (url: String, promise: Promise) in
      self.signalUrl = url
      SignalService.shared.start(
        url: url,
        httpClient: URLSession.shared,
        onPresence: { [weak self] presence in
          self?.sendEvent("onPresence", presence)
        },
        onSignalingState: { [weak self] state in
          self?.sendEvent("onSignalingStateChange", ["state": state])
        }
      )
      promise.resolve(nil)
    }

    /**
     * Connect to a remote peer by `requestId`. `type` is the remote peer type
     * (`"offer"` or `"answer"`). Resolves when the primary data channel opens;
     * rejects with `E_LINK_ERROR` on a refused link or `E_ABORTED` on cancel.
     */
    AsyncFunction("connect") { (
      requestId: String,
      type: String,
      iceServers: [[String: Any]]?,
      options: [String: Any]?,
      promise: Promise
    ) in
      guard let peerType = LiquidAuthPeerType(rawValue: type) else {
        promise.reject("E_INVALID_TYPE", "Invalid peer type '\(type)', expected 'offer' or 'answer'")
        return
      }
      guard let origin = self.signalUrl else {
        promise.reject("E_NOT_STARTED", "Signaling service not started, call start() first")
        return
      }

      self.pendingConnect = promise
      let servers = Self.parseIceServers(iceServers)
      let channels = Self.parseDataChannels(options)

      SignalService.shared.connectToPeer(
        requestId: requestId,
        type: peerType,
        origin: origin,
        iceServers: servers,
        dataChannels: channels,
        onMessage: { [weak self] channel, message in
          self?.sendEvent("onMessage", ["channel": channel, "message": message])
        },
        onStateChange: { [weak self] channel, state in
          var payload: [String: Any] = ["channel": channel]
          if let state { payload["state"] = state }
          self?.sendEvent("onStateChange", payload)
        },
        onLinkError: { [weak self] error in
          guard let self else { return }
          var payload: [String: Any] = ["event": "link-error"]
          if let reason = error.rawReason { payload["reason"] = reason }
          if let requestId = error.requestId { payload["requestId"] = requestId }
          if let message = error.message { payload["message"] = message }
          self.sendEvent("onLinkError", payload)
          if let pending = self.pendingConnect {
            self.pendingConnect = nil
            pending.reject("E_LINK_ERROR", error.errorDescription ?? "Link refused")
          }
        },
        onConnected: { [weak self] in
          guard let self, let pending = self.pendingConnect else { return }
          self.pendingConnect = nil
          pending.resolve(nil)
        },
        onPresence: { [weak self] presence in
          self?.sendEvent("onPresence", presence)
        },
        onConnectionStateChange: { [weak self] state in
          self?.sendEvent("onConnectionStateChange", ["state": state])
        },
        onSignalingState: { [weak self] state in
          self?.sendEvent("onSignalingStateChange", ["state": state])
        }
      )
    }

    /**
     * Abort an in-flight `connect` negotiation. The pending `connect` promise
     * rejects with `E_ABORTED`.
     */
    AsyncFunction("cancel") { (promise: Promise) in
      SignalService.shared.cancel()
      if let pending = self.pendingConnect {
        self.pendingConnect = nil
        pending.reject("E_ABORTED", "Connection aborted")
      }
      promise.resolve(nil)
    }

    /**
     * Snapshot the background service's CURRENT connection so a re-attaching
     * app can hydrate instead of assuming a fresh start. Returns
     * `{ connected, requestId, iceConnectionState, channels, signalingConnected }`.
     * Safe to call before the service is bound (returns `connected: false`).
     */
    Function("getConnectionState") { () -> [String: Any?] in
      return SignalService.shared.getConnectionState()
    }

    /**
     * Re-attach to the ALREADY-live connection without renegotiating: rebind
     * the message/state/presence/link-error/connection-state listeners to this
     * (fresh) JS runtime and re-emit the current channel + ICE state so the app
     * hydrates. Use when [getConnectionState] reports `connected: true` (e.g.
     * after a relaunch that reconnected to the still-running service).
     */
    AsyncFunction("attach") { (options: [String: Any]?, promise: Promise) in
      SignalService.shared.attach(
        onMessage: { [weak self] channel, message in
          self?.sendEvent("onMessage", ["channel": channel, "message": message])
        },
        onStateChange: { [weak self] channel, state in
          var payload: [String: Any] = ["channel": channel]
          if let state { payload["state"] = state }
          self?.sendEvent("onStateChange", payload)
        },
        onPresence: { [weak self] presence in
          self?.sendEvent("onPresence", presence)
        },
        onLinkError: { [weak self] error in
          guard let self else { return }
          var payload: [String: Any] = ["event": "link-error"]
          if let reason = error.rawReason { payload["reason"] = reason }
          if let requestId = error.requestId { payload["requestId"] = requestId }
          if let message = error.message { payload["message"] = message }
          self.sendEvent("onLinkError", payload)
        },
        onConnectionStateChange: { [weak self] state in
          self?.sendEvent("onConnectionStateChange", ["state": state])
        },
        onSignalingState: { [weak self] state in
          self?.sendEvent("onSignalingStateChange", ["state": state])
        }
      )
      promise.resolve(nil)
    }

    /**
     * Send a message over the primary (`liquid`) data channel.
     */
    Function("send") { (message: String) in
      SignalService.shared.sendMessage(message)
    }

    /**
     * Send a message over a specific named data channel.
     */
    Function("sendToChannel") { (channel: String, message: String) in
      SignalService.shared.sendMessage(message, to: channel)
    }

    /**
     * Stop the signaling client and tear down the connection.
     */
    AsyncFunction("disconnect") { (promise: Promise) in
      SignalService.shared.stop()
      if let pending = self.pendingConnect {
        self.pendingConnect = nil
        pending.reject("E_ABORTED", "Connection closed")
      }
      promise.resolve(nil)
    }
  }

  // MARK: - Parsing helpers

  /// Parse a `liquid://<host>/?requestId=<id>` URI into its origin + requestId.
  private static func parseLiquidUri(_ uri: String) -> (origin: String, requestId: String)? {
    guard let components = URLComponents(string: uri),
          let host = components.host,
          let requestId = components.queryItems?.first(where: { $0.name == "requestId" })?.value
    else {
      return nil
    }
    return (origin: host, requestId: requestId)
  }

  /// Convert the JS ICE server descriptors into `RTCIceServer`s, defaulting to
  /// a public STUN server when none are provided (mirrors the Android module).
  private static func parseIceServers(_ iceServers: [[String: Any]]?) -> [RTCIceServer] {
    guard let iceServers, !iceServers.isEmpty else {
      return [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
    }
    return iceServers.compactMap { server in
      let urls: [String]
      if let single = server["urls"] as? String {
        urls = [single]
      } else if let many = server["urls"] as? [String] {
        urls = many
      } else {
        return nil
      }
      if urls.isEmpty { return nil }
      if let username = server["username"] as? String,
         let credential = server["credential"] as? String {
        return RTCIceServer(urlStrings: urls, username: username, credential: credential)
      }
      return RTCIceServer(urlStrings: urls)
    }
  }

  /// Convert the JS `options.dataChannels` map into `DataChannelConfig`s,
  /// defaulting to a single `liquid` channel (mirrors the Android module).
  private static func parseDataChannels(_ options: [String: Any]?) -> [String: DataChannelConfig] {
    guard let raw = options?["dataChannels"] as? [String: Any], !raw.isEmpty else {
      return DataChannelConfig.defaultChannels
    }
    var result: [String: DataChannelConfig] = [:]
    for (label, value) in raw {
      let config = value as? [String: Any] ?? [:]
      let packetLifeTime = (config["maxPacketLifeTime"] as? NSNumber)
        ?? (config["maxRetransmitTimeMs"] as? NSNumber)
      result[label] = DataChannelConfig(
        ordered: config["ordered"] as? Bool,
        maxRetransmits: (config["maxRetransmits"] as? NSNumber)?.intValue,
        maxPacketLifeTime: packetLifeTime?.intValue,
        channelProtocol: config["protocol"] as? String,
        negotiated: config["negotiated"] as? Bool,
        channelId: (config["id"] as? NSNumber)?.intValue,
        order: (config["order"] as? NSNumber)?.intValue
      )
    }
    return result
  }
}
