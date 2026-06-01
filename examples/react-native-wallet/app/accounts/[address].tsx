import { SafeAreaView, ScrollView, StyleSheet, StatusBar, Text, View, Alert } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";

import {
  useProvider,
  useAccountByAddress,
  useKeys,
  useIdentities,
  useRootColors,
} from "@/hooks/useProvider";
import { isKeystoreAccount } from "@algorandfoundation/accounts-keystore-extension";
import { isAlgorandAccount } from "@algorandfoundation/accounts-algorand-extension";
import { isWatchedAccount } from "@/extensions/example";
import { HeaderCard, DetailSection, InfoRow, AssociationRow } from "@/components";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export default function AccountDetail() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const { account } = useProvider();
  const router = useRouter();
  const record = useAccountByAddress(address ?? null);
  const allKeys = useKeys();
  const identities = useIdentities();
  const { colorFor } = useRootColors();

  const keyId = (record?.metadata as any)?.keyId as string | undefined;
  const accentColor = colorFor(keyId);

  if (!record) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Account" }} />
        <StatusBar barStyle="dark-content" />
        <View style={styles.missing}>
          <MaterialCommunityIcons name="account-off" size={40} color="#999" />
          <Text style={styles.missingText}>Account not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  let icon: IconName = "account";
  let typeLabel = "Account";
  if (isKeystoreAccount(record)) {
    icon = "shield-key";
    typeLabel = "Keystore Account";
  } else if (isAlgorandAccount(record)) {
    icon = "alpha-a-circle-outline";
    typeLabel = "Algorand Account";
  } else if (isWatchedAccount(record)) {
    icon = "eye-outline";
    typeLabel = "Watched Account";
  }

  const sourceKey = allKeys.find((k) => k.id === keyId);
  // Lineage chain (key → parent → ... → root)
  const lineage: typeof allKeys = [];
  let cursor = sourceKey;
  while (cursor) {
    lineage.push(cursor);
    const parentId = (cursor.metadata as any)?.parentKeyId as string | undefined;
    cursor = parentId ? allKeys.find((k) => k.id === parentId) : undefined;
  }

  const siblingIdentities = identities.filter(
    (i) => (i.metadata as any)?.keyId && (i.metadata as any).keyId === keyId,
  );

  const handleRemove = () => {
    Alert.alert("Remove Account", "Remove this account from the store?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await account.store.removeAccount(record.address);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: typeLabel }} />
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <HeaderCard
          label={typeLabel}
          title={record.address.slice(0, 10) + "…"}
          icon={icon}
          accentColor={accentColor}
          actions={[{ label: "Remove", icon: "delete-outline", onPress: handleRemove }]}
        />

        <DetailSection title="Overview" accentColor={accentColor}>
          <InfoRow label="Address" value={record.address} mono />
          <InfoRow label="Type" value={record.type} />
          <InfoRow
            label="Balance"
            value={record.balance !== undefined ? String(record.balance) : null}
          />
          <InfoRow label="Assets" value={record.assets?.length ?? 0} />
        </DetailSection>

        {record.metadata && Object.keys(record.metadata).length > 0 && (
          <DetailSection title="Metadata" accentColor={accentColor}>
            {Object.entries(record.metadata).map(([k, v]) => (
              <InfoRow
                key={k}
                label={k}
                value={typeof v === "object" ? JSON.stringify(v) : String(v)}
              />
            ))}
          </DetailSection>
        )}

        <DetailSection title="Source Key" accentColor={accentColor} badge={sourceKey ? 1 : 0}>
          {sourceKey ? (
            <AssociationRow
              icon="key"
              title={sourceKey.id}
              subtitle={sourceKey.type}
              accentColor={accentColor}
              href={`/keys/${sourceKey.id}`}
            />
          ) : (
            <Text style={styles.empty}>No underlying key.</Text>
          )}
        </DetailSection>

        {lineage.length > 1 && (
          <DetailSection title="Key Lineage" accentColor={accentColor} badge={lineage.length}>
            {lineage.map((k) => (
              <AssociationRow
                key={k.id}
                icon={
                  k.type === "hd-seed"
                    ? "seed-outline"
                    : k.type === "hd-root-key"
                      ? "key-chain"
                      : "key"
                }
                title={k.id}
                subtitle={k.type}
                accentColor={accentColor}
                href={`/keys/${k.id}`}
              />
            ))}
          </DetailSection>
        )}

        <DetailSection
          title="Linked Identities"
          accentColor={accentColor}
          badge={siblingIdentities.length}
        >
          {siblingIdentities.length === 0 ? (
            <Text style={styles.empty}>No identities share this key.</Text>
          ) : (
            siblingIdentities.map((i) => (
              <AssociationRow
                key={i.address}
                icon="shield-account"
                title={i.address}
                subtitle={i.type}
                accentColor={accentColor}
                href={`/identities/${i.address}`}
              />
            ))
          )}
        </DetailSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA" },
  scroll: { padding: 20, paddingTop: 10, paddingBottom: 40 },
  empty: { fontSize: 13, color: "#999", paddingVertical: 8 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  missingText: { fontSize: 16, color: "#666" },
});
