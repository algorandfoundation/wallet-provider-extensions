Pod::Spec.new do |s|
  s.name           = 'LiquidAuthNative'
  s.version        = '1.0.0'
  s.summary        = 'React Native bindings for the Liquid Auth signaling service'
  s.description    = 'Native bindings that expose the Liquid Auth WebRTC signaling service to React Native / Expo apps.'
  s.author         = 'Algorand Foundation'
  s.homepage       = 'https://github.com/algorandfoundation/react-native-liquid-auth'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Native dependencies for the bundled LiquidAuthSDK signaling stack
  # (ported from liquid-auth-ios). Socket.IO drives the
  # signaling transport; WebRTC (Swift module `WebRTC`) provides the peer
  # connection / data channels. Must be JitsiWebRTC — the same binary
  # react-native-webrtc depends on — NOT stasel's 'WebRTC-lib': both vend a
  # framework named WebRTC.xcframework, and CocoaPods rejects the target with
  # "frameworks with conflicting names" when both are present.
  s.dependency 'Socket.IO-Client-Swift'
  s.dependency 'JitsiWebRTC', '~> 124.0.0'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.9',
  }

  # Includes both the module bindings and the bundled LiquidAuthSDK/ sources.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
