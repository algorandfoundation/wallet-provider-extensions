import { SafeAreaView, ScrollView, StyleSheet, StatusBar, Alert, Text, View } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";

import {
  useProvider,
  useKeyByID,
  useKeys,
  useAccounts,
  useIdentities,
  useRootColors,
} from "@/hooks/useProvider";
import { HeaderCard, DetailSection, InfoRow, AssociationRow } from "@/components";
import { formatKeyData } from "@/stores/keystore";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function iconForKeyType(type: string): IconName {
  if (type === "seed" || type === "hd-seed") return "seed-outline";
  if (type === "hd-root-key") return "key-chain";
  if (type === "falcon-1024") return "atom-variant";
  return "key";
}

function labelForKeyType(type: string): string {
  if (type === "seed" || type === "hd-seed") return "Seed";
  if (type === "hd-root-key") return "Root Key";
  if (type === "falcon-1024") return "Falcon Key";
  return "Derived Key";
}

export default function KeyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { key } = useProvider();
  const record = useKeyByID(id ?? null);
  const allKeys = useKeys();
  const accounts = useAccounts();
  const identities = useIdentities();
  const { colorFor } = useRootColors();

  const accentColor = colorFor(id);

  if (!record) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Key" }} />
        <StatusBar barStyle="dark-content" />
        <View style={styles.missing}>
          <MaterialCommunityIcons name="key-remove" size={40} color="#999" />
          <Text style={styles.missingText}>Key not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const parentKeyId = metadata.parentKeyId as string | undefined;
  const parent = allKeys.find((k) => k.id === parentKeyId);
  const children = allKeys.filter((k) => (k.metadata as any)?.parentKeyId === record.id);
  const linkedAccounts = accounts.filter((a) => (a.metadata as any)?.keyId === record.id);
  const linkedIdentities = identities.filter((i) => (i.metadata as any)?.keyId === record.id);

  const handleExport = async () => {
    try {
      const keyData = await key.store.export(record.id);
      Alert.alert("Key Material", formatKeyData(keyData), [{ text: "OK" }]);
    } catch (e: any) {
      Alert.alert("Export Failed", e.message);
    }
  };

  const handleRemove = () => {
    Alert.alert("Remove Key", "Are you sure you want to remove this key?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => key.store.remove(record.id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: labelForKeyType(record.type) }} />
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <HeaderCard
          label={labelForKeyType(record.type)}
          title={record.id.slice(0, 10) + "…"}
          icon={iconForKeyType(record.type)}
          accentColor={accentColor}
          actions={[
            { label: "Export", icon: "export-variant", onPress: handleExport },
            { label: "Remove", icon: "delete-outline", onPress: handleRemove },
          ]}
        />

        <DetailSection title="Overview" accentColor={accentColor}>
          <InfoRow label="Key ID" value={record.id} mono />
          <InfoRow label="Type" value={record.type} />
          <InfoRow label="Algorithm" value={record.algorithm} />
          <InfoRow label="Extractable" value={record.extractable ? "Yes" : "No"} />
          <InfoRow label="Usages" value={record.keyUsages?.join(", ")} />
        </DetailSection>

        {Object.keys(metadata).length > 0 && (
          <DetailSection title="Derivation" accentColor={accentColor}>
            {metadata.context !== undefined && (
              <InfoRow label="Context" value={String(metadata.context)} />
            )}
            {metadata.account !== undefined && (
              <InfoRow label="Account" value={String(metadata.account)} />
            )}
            {metadata.index !== undefined && (
              <InfoRow label="Index" value={String(metadata.index)} />
            )}
            {metadata.derivation !== undefined && (
              <InfoRow label="Derivation" value={String(metadata.derivation)} />
            )}
          </DetailSection>
        )}

        <DetailSection title="Parent" accentColor={accentColor} badge={parent ? 1 : 0}>
          {parent ? (
            <AssociationRow
              icon={iconForKeyType(parent.type)}
              title={parent.id}
              subtitle={labelForKeyType(parent.type)}
              accentColor={accentColor}
              href={`/keys/${parent.id}`}
            />
          ) : (
            <Text style={styles.empty}>No parent — this is a root.</Text>
          )}
        </DetailSection>

        <DetailSection title="Derived Keys" accentColor={accentColor} badge={children.length}>
          {children.length === 0 ? (
            <Text style={styles.empty}>No keys derived from this one.</Text>
          ) : (
            children.map((child) => (
              <AssociationRow
                key={child.id}
                icon={iconForKeyType(child.type)}
                title={child.id}
                subtitle={labelForKeyType(child.type)}
                accentColor={accentColor}
                href={`/keys/${child.id}`}
              />
            ))
          )}
        </DetailSection>

        <DetailSection title="Accounts" accentColor={accentColor} badge={linkedAccounts.length}>
          {linkedAccounts.length === 0 ? (
            <Text style={styles.empty}>No accounts use this key.</Text>
          ) : (
            linkedAccounts.map((acc) => (
              <AssociationRow
                key={acc.address}
                icon="account"
                title={acc.address}
                subtitle={acc.type}
                accentColor={accentColor}
                href={`/accounts/${acc.address}`}
              />
            ))
          )}
        </DetailSection>

        <DetailSection title="Identities" accentColor={accentColor} badge={linkedIdentities.length}>
          {linkedIdentities.length === 0 ? (
            <Text style={styles.empty}>No identities use this key.</Text>
          ) : (
            linkedIdentities.map((ident) => (
              <AssociationRow
                key={ident.address}
                icon="shield-account"
                title={ident.address}
                subtitle={ident.type}
                accentColor={accentColor}
                href={`/identities/${ident.address}`}
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
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  missingText: { fontSize: 16, color: "#666" },
});
