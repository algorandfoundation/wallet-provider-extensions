import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useStore } from "@tanstack/react-store";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { parseLiquidUri } from "@algorandfoundation/connections";

import { useProvider } from "@/hooks/useProvider";
import { resumeConnection } from "@/lib/connectionResume";
import { connectionsStore } from "@/stores/connections";
import { QrScannerModal } from "@/components";

/**
 * Remote dapp connections (Liquid Auth protocol).
 *
 * A connection reaches this screen as a **scanned / pasted `liquid://`
 * URI**: scan the dapp's QR with the camera (or paste / deep-link the
 * URI) and accept. A URI whose `requestId` matches a session this
 * wallet already tracks is the SAME pairing: it is resumed instead of
 * re-accepted, so no duplicate session is minted and no new approval
 * dialog pops.
 *
 * Connect and sign requests surface as native approval dialogs (see
 * `lib/connections.ts`).
 *
 * Disconnected sessions normally reconnect on their own (the
 * presence-driven auto-resume of `lib/connectionResume.ts`); the manual
 * **Resume** action is the recovery path; it may re-run the passkey
 * ceremony when the server session expired.
 */
export default function ConnectionsScreen() {
  const provider = useProvider();
  const router = useRouter();
  const { uri: incomingUri } = useLocalSearchParams<{ uri?: string }>();
  const sessions = useStore(connectionsStore, (state) => state.sessions);
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState<"accept" | null>(null);
  const [scanning, setScanning] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);

  const acceptUri = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setBusy("accept");
      try {
        // Guarantee the domain bridges (the session-scoped remote mirrors
        // the metas auto-load) are mounted before the handshake, so the
        // wallet's records travel the first exchange instead of the
        // domains degrading to announce-only.
        await Promise.all([
          provider.account.store.ready,
          provider.identity.store.ready,
          provider.passkey.store.ready,
          provider.credential.store.ready,
        ]);
        // A known requestId is the SAME pairing, so resume the tracked
        // session instead of running a brand-new accept (which would
        // replace the session and re-raise the approval dialog).
        let requestId: string | null = null;
        try {
          requestId = parseLiquidUri(trimmed).requestId;
        } catch {
          // Malformed URIs fall through to accept(), which surfaces
          // the typed error below.
        }
        const known =
          requestId !== null && connectionsStore.state.sessions.some((s) => s.id === requestId);
        const session = known
          ? await resumeConnection(provider, requestId as string)
          : await provider.connection.accept(trimmed);
        setUri("");
        Alert.alert(
          known ? "Reconnected" : "Connected",
          `Session ${session.id.slice(0, 8)}… is ${session.status}.`,
        );
      } catch (error) {
        Alert.alert("Connection failed", error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [provider],
  );

  const accept = useCallback(() => acceptUri(uri), [acceptUri, uri]);

  // A liquid:// URI handed over by the home screen's generic scanner (or a
  // deep link): prefill and accept it once. The param is CONSUMED
  // (cleared from the route) as soon as it is handled; otherwise it
  // sticks to the route, and a remount of this screen would re-accept
  // the same request and re-raise the approval dialog.
  const handledIncomingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!incomingUri || handledIncomingRef.current === incomingUri) return;
    handledIncomingRef.current = incomingUri;
    router.setParams({ uri: "" });
    setUri(incomingUri);
    void acceptUri(incomingUri);
  }, [incomingUri, acceptUri, router]);

  // Camera path: reject anything that is not a parseable liquid:// URI
  // while the scanner stays open, then accept the code immediately.
  const validateScan = useCallback((data: string) => {
    try {
      parseLiquidUri(data.trim());
      return null;
    } catch {
      return "Not a liquid:// connection QR code.";
    }
  }, []);

  const handleScanned = useCallback(
    (data: string) => {
      setScanning(false);
      setUri(data.trim());
      void acceptUri(data);
    },
    [acceptUri],
  );

  const disconnect = useCallback(
    (sessionId: string) => {
      void provider.connection.disconnect(sessionId);
    },
    [provider],
  );

  const resume = useCallback(
    async (sessionId: string) => {
      setResuming(sessionId);
      try {
        await resumeConnection(provider, sessionId);
      } catch (error) {
        Alert.alert("Resume failed", error instanceof Error ? error.message : String(error));
      } finally {
        setResuming(null);
      }
    },
    [provider],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Accept a connection</Text>
        <Text style={styles.hint}>
          Scan a dapp&apos;s QR code with the camera, or paste the liquid:// URI.
        </Text>
        <TextInput
          style={styles.input}
          value={uri}
          onChangeText={setUri}
          placeholder="liquid://liquid.example.com/?requestId=…"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.scanButton, busy !== null && styles.buttonDisabled]}
            onPress={() => setScanning(true)}
            disabled={busy !== null}
          >
            <MaterialCommunityIcons name="qrcode-scan" size={18} color="#5856D6" />
            <Text style={styles.scanButtonText}>Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.button,
              styles.acceptButton,
              (!uri.trim() || busy !== null) && styles.buttonDisabled,
            ]}
            onPress={accept}
            disabled={!uri.trim() || busy !== null}
          >
            {busy === "accept" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Accept</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sessions</Text>
        {sessions.length === 0 ? (
          <Text style={styles.hint}>No connections yet.</Text>
        ) : (
          sessions.map((session) => (
            <View key={session.id} style={styles.session}>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionOrigin} numberOfLines={1}>
                  {session.origin}
                </Text>
                <Text style={styles.sessionMeta}>
                  {session.id.slice(0, 8)}… · {statusLabel(session.status)}
                  {session.error ? ` — ${session.error}` : ""}
                </Text>
              </View>
              <View style={[styles.statusDot, statusColor(session.status)]} />
              {session.status === "connected" && (
                <TouchableOpacity onPress={() => disconnect(session.id)}>
                  <Text style={styles.danger}>Disconnect</Text>
                </TouchableOpacity>
              )}
              {(session.status === "disconnected" || session.status === "failed") && (
                <TouchableOpacity
                  onPress={() => void resume(session.id)}
                  disabled={resuming !== null}
                >
                  {resuming === session.id ? (
                    <ActivityIndicator size="small" color="#5856D6" />
                  ) : (
                    <Text style={styles.resumeAction}>Resume</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>

      <QrScannerModal
        visible={scanning}
        title="Scan connection QR"
        hint="Point the camera at the dapp's liquid:// QR code."
        validate={validateScan}
        onScanned={handleScanned}
        onClose={() => setScanning(false)}
      />
    </ScrollView>
  );
}

/**
 * The subtle status line of a session row: in-flight renegotiations
 * (`authenticating` / `connecting`) read as one "reconnecting…" phase.
 */
function statusLabel(status: string) {
  switch (status) {
    case "authenticating":
    case "connecting":
      return "reconnecting…";
    default:
      return status;
  }
}

function statusColor(status: string) {
  switch (status) {
    case "connected":
      return { backgroundColor: "#34C759" };
    case "failed":
      return { backgroundColor: "#FF3B30" };
    case "disconnected":
      return { backgroundColor: "#8E8E93" };
    default:
      return { backgroundColor: "#FF9500" };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA" },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
  hint: { color: "#6C757D", fontSize: 13, marginBottom: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: "#E9ECEF",
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    fontFamily: "monospace",
    marginBottom: 12,
  },
  actions: { flexDirection: "row", gap: 10 },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  scanButton: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#5856D6",
  },
  scanButtonText: { color: "#5856D6", fontWeight: "600" },
  acceptButton: { flex: 1, backgroundColor: "#5856D6" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "600" },
  session: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E9ECEF",
  },
  sessionInfo: { flex: 1 },
  sessionOrigin: { fontWeight: "600", fontSize: 14 },
  sessionMeta: { color: "#6C757D", fontSize: 12, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  danger: { color: "#FF3B30", fontWeight: "600", fontSize: 13 },
  resumeAction: { color: "#5856D6", fontWeight: "600", fontSize: 13 },
});
