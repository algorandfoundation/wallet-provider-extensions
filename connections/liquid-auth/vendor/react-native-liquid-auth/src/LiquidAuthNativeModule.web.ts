import { registerWebModule, NativeModule } from 'expo';

import {
  IceServer,
  LiquidAuthConnectionState,
  LiquidAuthConnectOptions,
  LiquidAuthMessage,
  LiquidAuthNativeModuleEvents,
  LiquidAuthPeerType,
  LiquidAuthResponse,
} from './LiquidAuthNative.types';

const UNSUPPORTED = 'LiquidAuthNative is not supported on web';

class LiquidAuthNativeModule extends NativeModule<LiquidAuthNativeModuleEvents> {
  generateRequestId(): string {
    throw new Error(UNSUPPORTED);
  }

  parseMessage(_value: string): LiquidAuthMessage {
    throw new Error(UNSUPPORTED);
  }

  async start(_url: string): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async connect(
    _requestId: string,
    _type: LiquidAuthPeerType,
    _iceServers?: IceServer[],
    _options?: LiquidAuthConnectOptions,
  ): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  getConnectionState(): LiquidAuthConnectionState {
    return {
      connected: false,
      requestId: null,
      iceConnectionState: null,
      channels: {},
      signalingConnected: false,
      lastPresence: null,
    };
  }

  async attach(_options?: LiquidAuthConnectOptions): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async cancel(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  setActive(_active: boolean): void {
    throw new Error(UNSUPPORTED);
  }

  flushQueue(): void {
    throw new Error(UNSUPPORTED);
  }

  send(_message: string): void {
    throw new Error(UNSUPPORTED);
  }

  sendToChannel(_channel: string, _message: string): void {
    throw new Error(UNSUPPORTED);
  }

  async disconnect(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async request(
    _url: string,
    _method: string,
    _headers?: Record<string, string>,
    _body?: string,
  ): Promise<LiquidAuthResponse> {
    throw new Error(UNSUPPORTED);
  }
}

export default registerWebModule(LiquidAuthNativeModule, 'LiquidAuthNativeModule');
