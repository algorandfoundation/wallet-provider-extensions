import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { fetchAssertionOptions } from "@algorandfoundation/connections";
import type { Passkey } from "@algorandfoundation/passkeys-core";

import { useProvider, usePasskeys } from "@/hooks/useProvider";
import { isPasskeyProviderSynced, syncPasskeyProviderKeys } from "@/lib/passkeyProvider";

/**
 * The Liquid Auth service the demo pair meets on: the same origin the
 * autofill config plugin declares as its `site` (see `app.json`), so the
 * passkeys listed here are the ones the service can ask for.
 */
const SIGNAL_URL = "https://debug.liquidauth.com";

/**
 * Passkeys held by this device's credential provider
 * (`react-native-passkey-autofill`).
 *
 * These are the entries Android's Credential Manager surfaces when a dapp
 * calls `navigator.credentials.get`. The wallet UI shares the provider's
 * native MMKV store through the passkeys extension: same records, same
 * types, no key material in JS.
 *
 * **Reconcile** fetches the WebAuthn request options the Liquid Auth
 * service would send for a passkey (`allowCredentials`) and marks local
 * entries as server-known / strays, so future requests can be built from
 * the local store without a server round-trip.
 */
export default function PasskeysScreen() {
  const provider = useProvider();
  const passkeys = usePasskeys();
  const [providerActive, setProviderActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"refresh" | "reconcile" | "sync" | null>(null);
  const [keysSynced, setKeysSynced] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    try {
      await provider.passkey.refresh();
      setProviderActive(await provider.passkey.providerActive());
      // The provider only serves entries once the wallet has shared its
      // master key + main key (see lib/passkeyProvider.ts).
      setKeysSynced(await isPasskeyProviderSynced());
    } catch (error) {
      console.warn("passkey refresh failed", error);
    } finally {
      setBusy(null);
    }
  }, [provider]);

  // Pick up passkeys created while the app was backgrounded (the
  // credential provider writes them natively) whenever the screen opens.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-probe when the app returns to the foreground: flipping the
  // credential-provider toggle happens in the OS Settings (see
  // `openSettings` below), so the active-provider status can only change
  // while we're backgrounded. Without this, the screen keeps showing the
  // stale status probed on mount.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const openSettings = useCallback(() => {
    void provider.passkey.openProviderSettings();
  }, [provider]);

  // Share the keystore master key + passkey main key with the credential
  // provider service. Until this runs, Android's Credential Manager shows
  // "No passkeys available" for every request routed here, including the
  // browser's FIDO hybrid (QR) flow and the `liquid` extension.
  const syncKeys = useCallback(async () => {
    setBusy("sync");
    try {
      await syncPasskeyProviderKeys(provider.key.store, { force: true });
      setKeysSynced(true);
      Alert.alert(
        "Wallet keys shared",
        "The credential provider can now register and serve passkeys.",
      );
    } catch (error) {
      Alert.alert("Sync failed", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [provider]);

  const remove = useCallback(
    (passkey: Passkey) => {
      Alert.alert(
        "Delete passkey",
        `Remove the passkey for ${passkey.rpId ?? passkey.origin ?? "unknown site"}? The relying party will no longer be able to authenticate with it.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void provider.passkey.store.removePasskey(passkey.credentialId),
          },
        ],
      );
    },
    [provider],
  );

  const reconcile = useCallback(
    async (passkey: Passkey) => {
      setBusy("reconcile");
      try {
        const options = await fetchAssertionOptions({
          url: SIGNAL_URL,
          credentialId: passkey.credentialId,
        });
        const result = await provider.passkey.store.reconcile(options);
        Alert.alert(
          "Reconciled",
          `${result.known.length} known · ${result.strays.length} stray(s) · ${result.missing.length} missing locally.`,
        );
      } catch (error) {
        Alert.alert("Reconcile failed", error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [provider],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Credential provider</Text>
        <Text style={styles.hint}>
          Autofill needs this wallet set as the device&apos;s passkey provider — that is what routes
          a dapp&apos;s `navigator.credentials.get` here.
        </Text>
        <View style={styles.rowBetween}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    providerActive === null ? "#FF9500" : providerActive ? "#34C759" : "#FF3B30",
                },
              ]}
            />
            <Text style={styles.statusText}>
              {providerActive === null
                ? "Checking…"
                : providerActive
                  ? "Active provider"
                  : "Not the active provider"}
            </Text>
          </View>
          {providerActive === false && (
            <TouchableOpacity onPress={openSettings}>
              <Text style={styles.link}>Enable</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.rowBetween}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    keysSynced === null ? "#FF9500" : keysSynced ? "#34C759" : "#FF3B30",
                },
              ]}
            />
            <Text style={styles.statusText}>
              {keysSynced === null
                ? "Checking…"
                : keysSynced
                  ? "Wallet keys shared"
                  : "Wallet keys not shared"}
            </Text>
          </View>
          <TouchableOpacity onPress={syncKeys} disabled={busy !== null}>
            <Text style={styles.link}>
              {busy === "sync" ? "Syncing…" : keysSynced ? "Re-sync" : "Sync"}
            </Text>
          </TouchableOpacity>
        </View>
        {keysSynced === false && (
          <Text style={styles.hint}>
            Until the wallet shares its master key and passkey main key with the provider service,
            Android shows “No passkeys available” for every request — tap Sync (requires a wallet
            seed).
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Stored passkeys</Text>
          <TouchableOpacity onPress={refresh} disabled={busy !== null}>
            <Text style={styles.link}>{busy === "refresh" ? "Refreshing…" : "Refresh"}</Text>
          </TouchableOpacity>
        </View>
        {passkeys.length === 0 ? (
          <Text style={styles.hint}>
            No passkeys yet. Register one from a dapp (navigator.credentials.create) with this
            wallet selected as the provider — the first Liquid Auth QR connection does this too.
          </Text>
        ) : (
          passkeys.map((passkey) => (
            <View key={passkey.credentialId} style={styles.passkey}>
              <View style={styles.passkeyInfo}>
                <Text style={styles.passkeyRp} numberOfLines={1}>
                  {passkey.rpId ?? passkey.origin ?? "unknown site"}
                </Text>
                <Text style={styles.passkeyMeta} numberOfLines={1}>
                  {passkey.userName ? `${passkey.userName} · ` : ""}
                  {passkey.credentialId.slice(0, 12)}…
                  {passkey.createdAt
                    ? ` · ${new Date(passkey.createdAt).toLocaleDateString()}`
                    : ""}
                </Text>
                {passkey.serverStatus && (
                  <Text
                    style={[
                      styles.badge,
                      passkey.serverStatus === "known" ? styles.badgeKnown : styles.badgeStray,
                    ]}
                  >
                    {passkey.serverStatus === "known" ? "server-known" : "not on server"}
                  </Text>
                )}
              </View>
              {busy === "reconcile" ? (
                <ActivityIndicator size="small" color="#5856D6" />
              ) : (
                <TouchableOpacity onPress={() => reconcile(passkey)}>
                  <Text style={styles.link}>Reconcile</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => remove(passkey)}>
                <Text style={styles.danger}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
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
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { fontSize: 14, fontWeight: "600" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  link: { color: "#5856D6", fontWeight: "600" },
  passkey: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E9ECEF",
  },
  passkeyInfo: { flex: 1 },
  passkeyRp: { fontWeight: "600", fontSize: 14 },
  passkeyMeta: { color: "#6C757D", fontSize: 12, marginTop: 2 },
  badge: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
  },
  badgeKnown: { backgroundColor: "#E7F8EC", color: "#1F7A38" },
  badgeStray: { backgroundColor: "#FDEBEA", color: "#B3261E" },
  danger: { color: "#FF3B30", fontWeight: "600", fontSize: 13 },
});
