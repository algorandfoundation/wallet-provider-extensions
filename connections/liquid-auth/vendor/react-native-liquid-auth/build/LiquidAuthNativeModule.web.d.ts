import { NativeModule } from 'expo';
import { IceServer, LiquidAuthConnectionState, LiquidAuthConnectOptions, LiquidAuthMessage, LiquidAuthNativeModuleEvents, LiquidAuthPeerType, LiquidAuthResponse } from './LiquidAuthNative.types';
declare class LiquidAuthNativeModule extends NativeModule<LiquidAuthNativeModuleEvents> {
    generateRequestId(): string;
    parseMessage(_value: string): LiquidAuthMessage;
    start(_url: string): Promise<void>;
    connect(_requestId: string, _type: LiquidAuthPeerType, _iceServers?: IceServer[], _options?: LiquidAuthConnectOptions): Promise<void>;
    getConnectionState(): LiquidAuthConnectionState;
    attach(_options?: LiquidAuthConnectOptions): Promise<void>;
    cancel(): Promise<void>;
    setActive(_active: boolean): void;
    flushQueue(): void;
    send(_message: string): void;
    sendToChannel(_channel: string, _message: string): void;
    disconnect(): Promise<void>;
    request(_url: string, _method: string, _headers?: Record<string, string>, _body?: string): Promise<LiquidAuthResponse>;
}
declare const _default: typeof LiquidAuthNativeModule;
export default _default;
//# sourceMappingURL=LiquidAuthNativeModule.web.d.ts.map