import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
} from "react-native";
import React from "react";
import { Link } from "expo-router";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import {
  useProvider,
  useAccounts,
  useKeystoreStatus,
  useKeys,
  useRootColors,
} from "@/hooks/useProvider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { isKeystoreAccount } from "@algorandfoundation/accounts-keystore-extension";
import { isAlgorandAccount } from "@algorandfoundation/accounts-algorand-extension";
import { isWatchedAccount } from "@/extensions/example";
import { Alert } from "react-native";
import { HeaderCard } from "@/components";

export default function Accounts() {
  const { account, key } = useProvider();
  const accounts = useAccounts();
  const keys = useKeys();
  const status = useKeystoreStatus();
  const { colorFor } = useRootColors();

  const handleRemoveAccount = async (address: string) => {
    try {
      await account.store.removeAccount(address);
    } catch (error: any) {
      console.error("Failed to remove account", error);
    }
  };

  const handleGenerateAccount = async () => {
    try {
      const rootKeys = keys.filter((k) => k.type === "hd-root-key");
      if (rootKeys.length === 0) {
        Alert.alert("No Root Key", "Please generate a seed first on the Keystore page.");
        return;
      }

      const activeSeed = rootKeys[0].id;
      // Find next index for context 0 (Accounts)
      const context0Keys = keys.filter(
        (k) => k.metadata?.context === 0 && k.metadata?.parentKeyId === activeSeed,
      );
      const nextIndex = context0Keys.length;

      await key.store.generate({
        type: "hd-derived-ed25519",
        algorithm: "EdDSA",
        extractable: true,
        keyUsages: ["sign", "verify"],
        params: {
          parentKeyId: activeSeed,
          context: 0,
          account: 0,
          index: nextIndex,
          derivation: 9,
        },
      });
    } catch (error: any) {
      Alert.alert("Failed to generate account key", error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <HeaderCard
          label="Accounts Extension"
          title={accounts.length}
          icon="account-group"
          accentColor="#34C759"
          actions={[
            {
              label: "Generate",
              icon: "account-plus-outline",
              onPress: handleGenerateAccount,
              disabled: status !== "idle",
            },
            {
              label: "Clear All",
              icon: "delete-sweep-outline",
              onPress: () => account.store.clear(),
              disabled: status !== "idle",
            },
          ]}
        />

        <Text style={styles.sectionTitle}>Accounts</Text>
        {accounts.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No accounts found.</Text>
          </Animated.View>
        ) : (
          accounts.map((item, i) => {
            // Color-code the account by the seed/root its underlying key descends from.
            const keyId = item.metadata?.keyId as string | undefined;
            const rootColor = colorFor(keyId);
            let iconName: React.ComponentProps<typeof MaterialCommunityIcons>["name"] = "account";
            let typeLabel: string | null = null;
            let subtitle: string | null = null;
            if (isKeystoreAccount(item)) {
              iconName = "shield-key";
              typeLabel = "Keystore Account";
            } else if (isAlgorandAccount(item)) {
              iconName = "alpha-a-circle-outline";
              typeLabel = "Algorand Account";
            } else if (isWatchedAccount(item)) {
              iconName = "eye-outline";
              typeLabel = "Watched Account";
              subtitle = item.name ?? null;
            } else if (item.metadata?.name) {
              subtitle = item.metadata.name as string;
            }

            return (
              <Animated.View
                key={item.address || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <Link href={`/accounts/${item.address}`} asChild>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={[styles.accountCard, { borderLeftColor: rootColor }]}
                  >
                    <View style={styles.accountInfo}>
                      <View
                        style={[styles.accountIconContainer, { backgroundColor: `${rootColor}1F` }]}
                      >
                        <MaterialCommunityIcons name={iconName} size={24} color={rootColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={styles.accountAddress}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {item.address}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          {typeLabel && (
                            <Text style={[styles.accountTypeLabel, { color: rootColor }]}>
                              {typeLabel}
                            </Text>
                          )}
                          {subtitle && (
                            <Text style={styles.accountMetadata}>
                              {typeLabel ? ` • ${subtitle}` : subtitle}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                    <View style={styles.accountActions}>
                      <TouchableOpacity
                        onPress={() => handleRemoveAccount(item.address)}
                        hitSlop={8}
                      >
                        <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </Link>
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 16,
    marginTop: 8,
  },
  accountCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  accountInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  accountIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F0F7FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  accountAddress: {
    fontSize: 16,
    color: "#1A1A1A",
    fontWeight: "600",
    fontFamily: "System",
  },
  accountTypeLabel: {
    fontSize: 10,
    color: "#999",
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  accountMetadata: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  accountActions: {
    marginLeft: 12,
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    borderRadius: 20,
    marginBottom: 16,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#CCC",
  },
  emptyStateText: {
    color: "#999",
    fontSize: 16,
  },
});
