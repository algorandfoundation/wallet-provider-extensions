import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Alert,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useRouter } from "expo-router";
import {
  useProvider,
  useKeys,
  useKeystoreStatus,
  useRootColors,
  useSelectedSeedId,
  useSelectedRootKeyId,
  useShims,
} from "@/hooks/useProvider";
import { setSelectedSeedId, setSelectedRootKeyId } from "@/stores/selection";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { HeaderCard, CapabilityList } from "@/components";
import {
  createWalletSeed,
  generateFalconKey,
  deriveAccountKey,
  nextAccountIndex,
  formatKeyData,
  bytesToHex,
  FALCON_ALGORITHM,
} from "@/stores/keystore";

export default function Index() {
  const { key } = useProvider();
  const keys = useKeys();
  const status = useKeystoreStatus();
  const router = useRouter();

  const selectedSeedId = useSelectedSeedId();
  const selectedRootKeyId = useSelectedRootKeyId();

  // The keystore's active capabilities (host algorithms + composable shim
  // add-ons), tagged by source. Falcon key generation is only offered when the
  // Falcon-1024 add-on actually resolved on this device.
  const capabilities = useShims();
  const canGenerateFalcon = capabilities.some((c) => c.algorithm === FALCON_ALGORITHM);

  const seeds = keys.filter((k) => k.type === "seed" || k.type === "hd-seed");
  const rootKeys = keys.filter((k) => k.type === "hd-root-key");
  const falconKeys = keys.filter((k) => k.type === "falcon-1024");
  const derivedKeys = keys.filter(
    (k) =>
      k.type !== "seed" &&
      k.type !== "hd-seed" &&
      k.type !== "hd-root-key" &&
      k.type !== "falcon-1024",
  );

  // Stable color mapping: every key is colored by the seed it descends from.
  const { byKeyId: rootKeyColors, colorFor } = useRootColors();

  // Root keys reference their originating seed via `metadata.rootKeyId`
  // (older flows used `parentKeyId`, kept as a fallback for compatibility).
  const seedIdForRoot = (k: (typeof rootKeys)[number]): string | undefined =>
    (k.metadata?.rootKeyId as string | undefined) ??
    (k.metadata?.parentKeyId as string | undefined);

  // Selecting a seed should also select its child root (if one exists)
  // so derived-key generation downstream has a sensible default.
  const handleSelectSeed = (seedId: string) => {
    setSelectedSeedId(seedId);
    const childRoot = rootKeys.find((k) => seedIdForRoot(k) === seedId);
    setSelectedRootKeyId(childRoot ? childRoot.id : null);
  };

  const handleSelectRootKey = (rootKeyId: string) => {
    setSelectedRootKeyId(rootKeyId);
    // Keep the parent seed selection in sync if available.
    const root = rootKeys.find((k) => k.id === rootKeyId);
    const parentSeedId = root ? seedIdForRoot(root) : undefined;
    if (parentSeedId) setSelectedSeedId(parentSeedId);
  };

  // Keep selections valid when the underlying keys change (e.g. removal).
  useEffect(() => {
    if (selectedSeedId && !seeds.some((s) => s.id === selectedSeedId)) {
      setSelectedSeedId(null);
    }
    if (selectedRootKeyId && !rootKeys.some((r) => r.id === selectedRootKeyId)) {
      setSelectedRootKeyId(null);
    }
  }, [seeds, rootKeys, selectedSeedId, selectedRootKeyId]);

  const handleImportSeed = async () => {
    try {
      // Delegate the multi-step mnemonic → seed → XHD root flow to the keystore
      // domain module, keeping the screen free of orchestration logic.
      const { seedId, rootKeyId, mnemonic } = await createWalletSeed(key.store);

      // Auto-select the newly created seed + its child root.
      setSelectedSeedId(seedId);
      setSelectedRootKeyId(rootKeyId);

      Alert.alert(
        "Wallet Seed Created",
        `Your 24-word recovery phrase:\n\n${mnemonic}\n\nKeep this phrase safe!`,
        [{ text: "OK" }],
      );
    } catch (error: any) {
      Alert.alert("Import Failed", error.message);
    }
  };

  const handleGenerateFalcon = async () => {
    if (!selectedSeedId) {
      Alert.alert("Select a Seed", "Choose a seed to derive the Falcon key from.");
      return;
    }
    try {
      await generateFalconKey(key.store, selectedSeedId);
    } catch (error: any) {
      Alert.alert("Falcon Generation Failed", error.message);
    }
  };

  // Mirror the web example's "Generate account" flow: derive the next standard
  // BIP32-Ed25519 account from the selected root key (falling back to the first
  // root). The accounts extension auto-populates an on-chain account from it.
  const handleGenerateAccount = async () => {
    const rootKeyId = selectedRootKeyId ?? rootKeys[0]?.id;
    if (!rootKeyId) {
      Alert.alert("No Root Key", "Generate a seed first to create a root key.");
      return;
    }
    try {
      await deriveAccountKey(key.store, {
        rootKeyId,
        index: nextAccountIndex(keys, rootKeyId),
      });
    } catch (error: any) {
      Alert.alert("Derive Account Failed", error.message);
    }
  };

  // Mirror the web example's per-key "Sign & verify": sign a short demo message
  // and immediately verify the signature, surfacing the result.
  const handleSignKey = async (id: string) => {
    try {
      const message = new TextEncoder().encode("hello from the react native keystore");
      const signature = await key.store.sign(id, message);
      const valid = await key.store.verify(id, message, signature);
      Alert.alert(
        "Sign & Verify",
        `Verified: ${valid ? "\u2705" : "\u274c"}\n\nSignature:\n${bytesToHex(signature)}`,
        [{ text: "OK" }],
      );
    } catch (error: any) {
      Alert.alert("Sign Failed", error.message);
    }
  };

  // Mirror the web example's per-key "Remove", with a confirmation step.
  const handleRemoveKey = (id: string) => {
    Alert.alert("Remove Key", "Are you sure you want to remove this key?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => key.store.remove(id) },
    ]);
  };

  const handleExportKey = async (id: string) => {
    try {
      const keyData = await key.store.export(id);
      Alert.alert("Key Material", formatKeyData(keyData), [{ text: "OK" }]);
    } catch (error: any) {
      Alert.alert("Export Failed", error.message);
    }
  };

  // Shared per-key action row, mirroring the web example's key card: Sign &
  // verify (only for signing keys), Export, Remove and a details chevron. Used
  // by every key section below so the actions stay consistent.
  const renderKeyActions = (item: (typeof keys)[number]) => (
    <View style={styles.keyActions}>
      {item.keyUsages?.includes("sign") && (
        <TouchableOpacity
          onPress={() => handleSignKey(item.id)}
          style={styles.actionIcon}
          hitSlop={8}
          accessibilityLabel="Sign and verify"
        >
          <MaterialCommunityIcons name="signature-freehand" size={24} color="#007AFF" />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={() => handleExportKey(item.id)}
        style={styles.actionIcon}
        accessibilityLabel="Export"
      >
        <MaterialCommunityIcons name="export-variant" size={24} color="#007AFF" />
        {item.extractable && <View style={styles.exportBadgeSmall} />}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleRemoveKey(item.id)}
        style={styles.actionIcon}
        hitSlop={8}
        accessibilityLabel="Remove"
      >
        <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => router.push(`/keys/${item.id}`)}
        style={styles.actionIcon}
        hitSlop={8}
        accessibilityLabel="View details"
      >
        <MaterialCommunityIcons name="chevron-right-circle" size={24} color="#007AFF" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <HeaderCard
          label="Keystore Extension"
          title={seeds.length + rootKeys.length}
          icon="key-variant"
          accentColor="#007AFF"
          actions={[
            {
              label: "Seed",
              icon: "seed-plus",
              onPress: handleImportSeed,
              disabled: status !== "idle",
            },
            {
              label: "Account",
              icon: "account-plus-outline",
              onPress: handleGenerateAccount,
              disabled: status !== "idle" || rootKeys.length === 0,
            },
            {
              label: "Falcon",
              icon: "atom-variant",
              onPress: handleGenerateFalcon,
              disabled: status !== "idle" || !selectedSeedId || !canGenerateFalcon,
            },
            {
              label: "Clear",
              icon: "delete-sweep-outline",
              onPress: () => key.store.clear(),
              disabled: status !== "idle",
            },
          ]}
        />

        <Text style={styles.sectionTitle}>Available Algorithms</Text>
        <CapabilityList capabilities={capabilities} accentColor="#007AFF" />

        <Text style={styles.sectionTitle}>Seeds</Text>
        {seeds.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No seeds yet.</Text>
          </Animated.View>
        ) : (
          seeds.map((item, i) => {
            const rootColor = rootKeyColors[item.id] || "#666";
            return (
              <Animated.View
                key={item.id || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={[
                    styles.keyCard,
                    selectedSeedId === item.id && styles.activeKeyCard,
                    selectedSeedId === item.id && { borderColor: rootColor },
                  ]}
                  onPress={() => handleSelectSeed(item.id)}
                >
                  <View style={styles.keyInfo}>
                    <View style={[styles.keyIconContainer, { backgroundColor: `${rootColor}15` }]}>
                      <MaterialCommunityIcons
                        name="seed-outline"
                        size={20}
                        color={selectedSeedId === item.id ? rootColor : `${rootColor}80`}
                      />
                    </View>
                    <View>
                      <Text
                        style={[
                          styles.keyType,
                          selectedSeedId === item.id && styles.activeKeyType,
                          selectedSeedId === item.id && { color: rootColor },
                        ]}
                      >
                        {item.type}
                        {(item as any).privateKey && (
                          <MaterialCommunityIcons
                            name="alert-circle"
                            size={16}
                            color="#FF3B30"
                            style={styles.warningIcon}
                          />
                        )}
                      </Text>
                      <Text style={styles.keyAddress}>{item.algorithm}</Text>
                    </View>
                  </View>
                  {renderKeyActions(item)}
                </TouchableOpacity>
              </Animated.View>
            );
          })
        )}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Root Keys</Text>
        {rootKeys.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No root keys yet.</Text>
          </Animated.View>
        ) : (
          rootKeys.map((item, i) => {
            const rootColor = rootKeyColors[item.id] || "#666";
            return (
              <Animated.View
                key={item.id || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={[
                    styles.keyCard,
                    selectedRootKeyId === item.id && styles.activeKeyCard,
                    selectedRootKeyId === item.id && { borderColor: rootColor },
                  ]}
                  onPress={() => handleSelectRootKey(item.id)}
                >
                  <View style={styles.keyInfo}>
                    <View style={[styles.keyIconContainer, { backgroundColor: `${rootColor}15` }]}>
                      <MaterialCommunityIcons
                        name="key-chain"
                        size={20}
                        color={selectedRootKeyId === item.id ? rootColor : `${rootColor}80`}
                      />
                    </View>
                    <View>
                      <Text
                        style={[
                          styles.keyType,
                          selectedRootKeyId === item.id && styles.activeKeyType,
                          selectedRootKeyId === item.id && { color: rootColor },
                        ]}
                      >
                        {item.type}
                        {(item as any).privateKey && (
                          <MaterialCommunityIcons
                            name="alert-circle"
                            size={16}
                            color="#FF3B30"
                            style={styles.warningIcon}
                          />
                        )}
                      </Text>
                      <Text style={styles.keyAddress}>{item.algorithm}</Text>
                    </View>
                  </View>
                  {renderKeyActions(item)}
                </TouchableOpacity>
              </Animated.View>
            );
          })
        )}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Falcon Keys</Text>
        {falconKeys.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              {canGenerateFalcon
                ? "No Falcon keys yet. Select a seed and tap “Falcon Key”."
                : "Falcon-1024 is not available on this device."}
            </Text>
          </Animated.View>
        ) : (
          falconKeys.map((item, i) => {
            const parentColor = colorFor(item.metadata?.parentKeyId as string);
            return (
              <Animated.View
                key={item.id || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <View style={styles.keyCard}>
                  <View style={styles.keyInfo}>
                    <View
                      style={[styles.keyIconContainer, { backgroundColor: `${parentColor}15` }]}
                    >
                      <MaterialCommunityIcons name="atom-variant" size={20} color={parentColor} />
                    </View>
                    <View>
                      <Text style={[styles.keyType, { color: parentColor }]}>{item.type}</Text>
                      <Text style={styles.keyAddress}>{item.algorithm}</Text>
                    </View>
                  </View>
                  {renderKeyActions(item)}
                </View>
              </Animated.View>
            );
          })
        )}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Derived Keys</Text>
        {derivedKeys.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No derived keys yet.</Text>
          </Animated.View>
        ) : (
          derivedKeys.map((item, i) => {
            const parentColor = rootKeyColors[item.metadata?.parentKeyId as string] || "#666";
            return (
              <Animated.View
                key={item.id || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <View style={styles.keyCard}>
                  <View style={styles.keyInfo}>
                    <View
                      style={[styles.keyIconContainer, { backgroundColor: `${parentColor}15` }]}
                    >
                      <MaterialCommunityIcons name="key" size={20} color={parentColor} />
                    </View>
                    <View>
                      <Text style={[styles.keyType, { color: parentColor }]}>
                        {item.type}
                        {item.type === "hd-derived-ed25519" && item.metadata && (
                          <Text style={styles.keyIndex}>
                            {" "}
                            (a:{item.metadata.account as number} i:{item.metadata.index as number})
                          </Text>
                        )}
                        {(item as any).privateKey && (
                          <MaterialCommunityIcons
                            name="alert-circle"
                            size={16}
                            color="#FF3B30"
                            style={styles.warningIcon}
                          />
                        )}
                      </Text>
                      <Text style={styles.keyAddress}>{item.algorithm}</Text>
                    </View>
                  </View>
                  {renderKeyActions(item)}
                </View>
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  scrollContent: {
    padding: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  walletName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1A1A1A",
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 16,
    marginTop: 8,
  },
  keyCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  activeKeyCard: {
    borderColor: "#007AFF",
    backgroundColor: "#F0F7FF",
  },
  keyInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  keyIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F0F0F0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  activeKeyIconContainer: {
    backgroundColor: "#E3F2FD",
  },
  keyType: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#666",
    marginBottom: 2,
  },
  activeKeyType: {
    color: "#007AFF",
  },
  keyIndex: {
    fontSize: 10,
    color: "#666",
    fontWeight: "normal",
  },
  exportBadgeSmall: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#4CAF50",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  warningIcon: {
    marginLeft: 8,
  },
  keyAddress: {
    fontSize: 15,
    color: "#333",
    fontWeight: "500",
  },
  keyActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionIcon: {
    marginRight: 12,
  },
  keyId: {
    fontSize: 14,
    color: "#999",
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    borderRadius: 12,
    marginBottom: 16,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#CCC",
  },
  emptyStateText: {
    color: "#999",
  },
  inputContainer: {
    flexDirection: "row",
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    padding: 12,
    marginRight: 10,
    borderRadius: 12,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    justifyContent: "center",
    borderRadius: 12,
  },
  addButtonText: {
    color: "#FFF",
    fontWeight: "bold",
  },
  secretItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#FFF",
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#F0F0F0",
  },
  secretName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  secretId: {
    fontSize: 11,
    color: "#999",
  },
});
