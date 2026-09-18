# react-native-liquid-auth

> **VENDORED SNAPSHOT** — this is a temporary in-tree copy consumed by
> `@algorandfoundation/connections-liquid-auth` (and the react-native-wallet
> example) while `react-native-liquid-auth` is unpublished. Once the package
> lands on npm, delete this directory and switch the `workspace:*` references
> to the published version. Do not develop here; upstream lives at
> <https://github.com/algorandfoundation/react-native-liquid-auth>.

Native bindings for the [Liquid Auth](https://github.com/algorandfoundation/liquid-auth-android)
WebRTC **signaling service**, packaged as an [Expo module](https://docs.expo.dev/modules/overview/).

Wallets can drive the Liquid Auth pairing/signaling handshake from JavaScript
through a background (foreground) service running natively, instead of talking to
the signaling client directly.

## What was migrated

The native signaling stack from `liquid-auth-android` (the `foundation.algorand.auth.connect`
package) is bundled here:

- `SignalService` – a bound, foreground `Service` that keeps the signaling
  socket + WebRTC peer alive while the app is backgrounded.
- `SignalClient` – Socket.IO signaling + WebRTC offer/answer negotiation.
- `PeerApi` – thin wrapper around the native `PeerConnection` / `DataChannel`.
- `AuthMessage` – parses `liquid://<origin>/?requestId=<id>` URIs.

`LiquidAuthNativeModule` (Kotlin) binds to `SignalService` and exposes it to
JavaScript, forwarding data-channel messages/state through events.

## Platform support

| Platform | Status |
| -------- | ------ |
| Android  | ✅ Full signaling service |
| iOS      | ⚠️ API stub (throws / rejects until an iOS implementation is added) |
| Web      | ⚠️ Not supported (throws) |

## Installation

```sh
npx expo install react-native-liquid-auth
```

## Usage

```ts
import {
  addMessageListener,
  addStateChangeListener,
  connect,
  disconnect,
  generateRequestId,
  parseMessage,
  send,
  start,
} from 'react-native-liquid-auth';

// Optional: parse a scanned `liquid://` QR code
const { origin, requestId } = parseMessage(scannedValue);

// Listen for peer messages / state changes (both carry the `channel` label)
const messageSub = addMessageListener(({ channel, message }) =>
  console.log('peer:', channel, message)
);
const stateSub = addStateChangeListener(({ channel, state }) =>
  console.log('state:', channel, state)
);

// Start the background signaling service against the origin
await start(origin);

// Connect to the remote peer (the remote peer type is `answer` or `offer`)
await connect(requestId, 'answer', [
  { urls: ['stun:stun.l.google.com:19302'] },
  {
    urls: ['turn:global.turn.nodely.network:80?transport=tcp'],
    username: 'liquid-auth',
    credential: '<credential>',
  },
]);

// Send a message over the primary (`liquid`) data channel
send(JSON.stringify({ type: 'ping' }));

// Tear down
messageSub.remove();
stateSub.remove();
await disconnect();
```

### Named data channels & media tracks

Mirroring the `options` argument of `SignalClient.peer()` in
[`liquid-auth-js`](https://github.com/algorandfoundation/liquid-auth-js), you can
open multiple named data channels (e.g. the AC2 wallet `ac2-v1` / `ac2-stream` /
`ac2-heartbeat` layout) by passing `options.dataChannels` when acting as the
offerer (`type: 'answer'`):

```ts
import {
  addMessageListener,
  addTrackListener,
  connect,
  sendToChannel,
} from 'react-native-liquid-auth';

await connect(requestId, 'answer', iceServers, {
  dataChannels: {
    'ac2-v1': { ordered: true },
    'ac2-stream': { ordered: true },
    'ac2-heartbeat': { ordered: true },
  },
});

// Route messages by channel label
addMessageListener(({ channel, message }) => {
  if (channel === 'ac2-v1') handleControl(message);
});

// Send over a specific named channel
sendToChannel('ac2-v1', JSON.stringify({ type: 'ping' }));

// Remote media tracks added to the peer connection are surfaced via `onTrack`
addTrackListener(({ id, kind, enabled }) => console.log('track:', kind, id, enabled));
```

Each `DataChannelInit` supports the usual `RTCDataChannelInit` fields
(`ordered`, `maxRetransmits`, `maxPacketLifeTime`, `protocol`, `negotiated`,
`id`). When no `dataChannels` are supplied a single `liquid` channel is opened,
preserving the previous behaviour.

## API

| Function | Description |
| -------- | ----------- |
| `generateRequestId(): string` | Generate a time-based UUID request id. |
| `parseMessage(value): { origin, requestId }` | Parse a `liquid://` URI (or JSON payload). |
| `start(url): Promise<void>` | Start/bind the foreground signaling service and connect to `url`. |
| `connect(requestId, type, iceServers?, options?): Promise<void>` | Negotiate a WebRTC peer connection. `options.dataChannels` opens named channels. |
| `send(message): void` | Send a string over the primary (`liquid`) data channel. |
| `sendToChannel(channel, message): void` | Send a string over a specific named data channel. |
| `disconnect(): Promise<void>` | Stop the client and unbind the service. |
| `addMessageListener(cb)` / `addStateChangeListener(cb)` | Subscribe to `onMessage` / `onStateChange` events (each event includes the `channel` label). |
| `addTrackListener(cb)` | Subscribe to `onTrack` events for remote media tracks. |

## License

Apache 2.0
