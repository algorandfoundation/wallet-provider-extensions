import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Alert,
} from "react-native";
import React from "react";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useRouter } from "expo-router";
import {
  useProvider,
  useKeys,
  useKeystoreStatus,
  useRootColors,
  useShims,
} from "@/hooks/useProvider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { HeaderCard, CapabilityList } from "@/components";
import { createWalletSeed, mintEd25519Key, formatKeyData, bytesToHex } from "@/stores/keystore";
import { syncPasskeyProviderKeys } from "@/lib/passkeyProvider";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * Per-key-type icon for the flat key list. Every key the keystore holds is
 * listed in one place (seeds, roots, HD children, standalone ed25519 and
 * post-quantum Falcon keys) with its type as the label.
 */
const KEY_TYPE_ICONS: Record<string, IconName> = {
  seed: "seed-outline",
  "hd-seed": "seed-outline",
  "hd-root-key": "key-chain",
  "hd-derived-ed25519": "key",
  ed25519: "key-outline",
  "falcon-1024": "atom-variant",
};

export default function Index() {
  const { key } = useProvider();
  const keys = useKeys();
  const status = useKeystoreStatus();
  const router = useRouter();

  // The keystore's active capabilities (host algorithms + composable shim
  // add-ons), tagged by source.
  const capabilities = useShims();

  // Stable color mapping: every key is colored by the seed it descends from.
  const { colorFor } = useRootColors();

  const handleImportSeed = async () => {
    try {
      // Delegate the multi-step mnemonic → seed → XHD root flow to the keystore
      // domain module, keeping the screen free of orchestration logic.
      const { mnemonic } = await createWalletSeed(key.store);

      Alert.alert(
        "Wallet Seed Created",
        `Your 24-word recovery phrase:\n\n${mnemonic}\n\nKeep this phrase safe!`,
        [
          {
            text: "OK",
            // Set up the credential provider in the same pass: derive the
            // deterministic-P256 passkey main key from the new seed and share
            // it (plus the keystore master key) with the autofill service;
            // without this, Credential Manager shows "No passkeys available"
            // for every get/create request. Best-effort: a failure here can
            // be retried from the Passkeys screen's Sync action.
            onPress: () => {
              void syncPasskeyProviderKeys(key.store).catch((error) =>
                console.warn("passkey provider sync failed", error),
              );
            },
          },
        ],
      );
    } catch (error: any) {
      Alert.alert("Import Failed", error.message);
    }
  };

  // Mint a fresh standalone ed25519 key: the accounts-keystore bridge
  // auto-populates a keystore account for it, so this is the "new ed25519
  // key account" action (HD and Falcon accounts are generated from the
  // Accounts screen).
  const handleMintEd25519 = async () => {
    try {
      await mintEd25519Key(key.store);
    } catch (error: any) {
      Alert.alert("Mint Ed25519 Failed", error.message);
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
      {
        text: "Remove",
        style: "destructive",
        onPress: () => key.store.remove(id),
      },
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
          title={keys.length}
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
              label: "Ed25519",
              icon: "key-plus",
              onPress: handleMintEd25519,
              disabled: status !== "idle",
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

        <Text style={styles.sectionTitle}>Available Keys</Text>
        {keys.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              No keys yet. Create a seed or mint an ed25519 key to get started.
            </Text>
          </Animated.View>
        ) : (
          keys.map((item, i) => {
            // Color by the seed/root the key descends from (fallback for
            // standalone keys with no ancestor).
            const keyColor = colorFor(item.id);
            const iconName = KEY_TYPE_ICONS[item.type] ?? "key";
            return (
              <Animated.View
                key={item.id || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <View style={styles.keyCard}>
                  <View style={styles.keyInfo}>
                    <View style={[styles.keyIconContainer, { backgroundColor: `${keyColor}15` }]}>
                      <MaterialCommunityIcons name={iconName} size={20} color={keyColor} />
                    </View>
                    <View>
                      <Text style={[styles.keyType, { color: keyColor }]}>
                        {item.type}
                        {item.type === "hd-derived-ed25519" && item.metadata && (
                          <Text style={styles.keyIndex}>
                            {" "}
                            (a:{item.metadata.account as number} i:
                            {item.metadata.index as number})
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
  keyType: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#666",
    marginBottom: 2,
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
