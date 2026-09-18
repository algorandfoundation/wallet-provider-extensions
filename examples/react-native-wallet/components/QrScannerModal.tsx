import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";

export interface QrScannerModalProps {
  /** Whether the scanner is shown. */
  visible: boolean;
  /** Title rendered above the viewfinder. */
  title?: string;
  /** Hint rendered under the title (what QR the user should point at). */
  hint?: string;
  /**
   * Optional payload validator. Return an error message to reject the
   * scanned code (the message is shown and scanning continues), or
   * `null` to accept it.
   */
  validate?: (data: string) => string | null;
  /** Called once with the accepted QR payload. */
  onScanned: (data: string) => void;
  /** Called when the user dismisses the scanner. */
  onClose: () => void;
}

/**
 * A full-screen camera QR scanner (expo-camera), shared by the flows
 * that ingest out-of-band payloads:
 *
 * - **Connections**: the `liquid://` request URI, Liquid Auth's
 *   cross-device QR fallback when the passkey (`navigator.credentials.get`)
 *   path is unavailable.
 * - future credential offers / presentation requests.
 *
 * Handles the camera permission prompt, scans a single code (re-arming
 * only after a rejected payload), and offers a torch toggle for
 * low-light scanning.
 */
export function QrScannerModal({
  visible,
  title = "Scan QR code",
  hint,
  validate,
  onScanned,
  onClose,
}: QrScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  // Bar codes fire once per frame; latch after the first accepted scan
  // so a single QR doesn't trigger the callback dozens of times.
  const handledRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    handledRef.current = false;
    setRejection(null);
    setTorch(false);
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (handledRef.current || !data) return;
      const error = validate ? validate(data) : null;
      if (error) {
        // Keep scanning; surface why this code was rejected.
        setRejection(error);
        return;
      }
      handledRef.current = true;
      onScanned(data);
    },
    [validate, onScanned],
  );

  const denied = permission !== null && !permission.granted && !permission.canAskAgain;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : (
          <View style={styles.permission}>
            <MaterialCommunityIcons name="camera-off-outline" size={48} color="#8E8E93" />
            <Text style={styles.permissionText}>
              {denied
                ? "Camera access is denied. Enable it in Settings to scan QR codes."
                : "Camera permission is required to scan QR codes."}
            </Text>
            {!denied && (
              <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                <Text style={styles.permissionButtonText}>Grant access</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {permission?.granted && (
            <View style={styles.viewfinder}>
              <View style={styles.frame} />
              {rejection ? <Text style={styles.rejection}>{rejection}</Text> : null}
            </View>
          )}

          <View style={styles.footer}>
            {permission?.granted && (
              <TouchableOpacity style={styles.iconButton} onPress={() => setTorch((on) => !on)}>
                <MaterialCommunityIcons
                  name={torch ? "flashlight" : "flashlight-off"}
                  size={24}
                  color="#fff"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 20,
    paddingTop: 56,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerText: { flex: 1 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  hint: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewfinder: { alignItems: "center", gap: 16 },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.85)",
  },
  rejection: {
    color: "#fff",
    backgroundColor: "rgba(255,59,48,0.85)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    overflow: "hidden",
  },
  footer: { alignItems: "center" },
  permission: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  permissionText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: "#5856D6",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  permissionButtonText: { color: "#fff", fontWeight: "600" },
});
