import { registerWebModule, NativeModule } from 'expo';
const UNSUPPORTED = 'LiquidAuthNative is not supported on web';
class LiquidAuthNativeModule extends NativeModule {
    generateRequestId() {
        throw new Error(UNSUPPORTED);
    }
    parseMessage(_value) {
        throw new Error(UNSUPPORTED);
    }
    async start(_url) {
        throw new Error(UNSUPPORTED);
    }
    async connect(_requestId, _type, _iceServers, _options) {
        throw new Error(UNSUPPORTED);
    }
    getConnectionState() {
        return {
            connected: false,
            requestId: null,
            iceConnectionState: null,
            channels: {},
            signalingConnected: false,
            lastPresence: null,
        };
    }
    async attach(_options) {
        throw new Error(UNSUPPORTED);
    }
    async cancel() {
        throw new Error(UNSUPPORTED);
    }
    setActive(_active) {
        throw new Error(UNSUPPORTED);
    }
    flushQueue() {
        throw new Error(UNSUPPORTED);
    }
    send(_message) {
        throw new Error(UNSUPPORTED);
    }
    sendToChannel(_channel, _message) {
        throw new Error(UNSUPPORTED);
    }
    async disconnect() {
        throw new Error(UNSUPPORTED);
    }
    async request(_url, _method, _headers, _body) {
        throw new Error(UNSUPPORTED);
    }
}
export default registerWebModule(LiquidAuthNativeModule, 'LiquidAuthNativeModule');
//# sourceMappingURL=LiquidAuthNativeModule.web.js.map