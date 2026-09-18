import { SafeAreaView, ScrollView, StyleSheet, StatusBar, Text, View, Alert } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { parseSdJwtVc } from "@algorandfoundation/credentials";

import { useProvider, useCredentialById, useIdentities, useRootColors } from "@/hooks/useProvider";
import { HeaderCard, DetailSection, InfoRow, AssociationRow } from "@/components";

export default function CredentialDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { credential } = useProvider();
  const router = useRouter();
  const record = useCredentialById(id ?? null);
  const identities = useIdentities();
  const { colorFor } = useRootColors();

  const holder = identities.find((i) => i.address === record?.identityAddress);
  const accentColor = colorFor(holder?.metadata?.keyId as string | undefined);

  if (!record) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Credential" }} />
        <StatusBar barStyle="dark-content" />
        <View style={styles.missing}>
          <MaterialCommunityIcons name="card-off-outline" size={40} color="#999" />
          <Text style={styles.missingText}>Credential not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Re-parse the raw SD-JWT VC to surface its selective disclosures.
  let disclosures: { name?: string; value: unknown }[] = [];
  if (record.format === "vc+sd-jwt" && typeof record.raw === "string") {
    try {
      disclosures = parseSdJwtVc(record.raw).disclosures;
    } catch {
      // Non-parseable raw payloads simply render without a disclosures section.
    }
  }

  const handleExport = () => {
    const raw = typeof record.raw === "string" ? record.raw : "<binary payload>";
    Alert.alert("Raw Credential", raw, [{ text: "OK" }]);
  };

  const handleRemove = () => {
    Alert.alert("Remove Credential", "Remove this credential from the store?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await credential.store.removeCredential(record.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: "Credential" }} />
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <HeaderCard
          label={record.format}
          title={record.name}
          icon="card-account-details"
          accentColor={accentColor}
          actions={[
            { label: "Export Raw", icon: "file-document-outline", onPress: handleExport },
            { label: "Remove", icon: "delete-outline", onPress: handleRemove },
          ]}
        />

        <DetailSection title="Overview" accentColor={accentColor}>
          <InfoRow label="ID" value={record.id} mono />
          <InfoRow label="Type" value={record.type.join(", ")} />
          <InfoRow label="Format" value={record.format} />
          <InfoRow label="Issuer" value={record.issuer} mono />
          <InfoRow label="Holder" value={record.holder ?? record.identityAddress} mono />
          {record.issuedAt && <InfoRow label="Issued At" value={record.issuedAt} />}
          {record.expiresAt && <InfoRow label="Expires At" value={record.expiresAt} />}
          {record.description && <InfoRow label="Description" value={record.description} />}
        </DetailSection>

        <DetailSection title="Holder Identity" accentColor={accentColor} badge={holder ? 1 : 0}>
          {holder ? (
            <AssociationRow
              icon="shield-account"
              title={holder.address}
              subtitle={holder.type}
              accentColor={accentColor}
              href={`/identities/${holder.address}`}
            />
          ) : (
            <Text style={styles.empty}>Holder identity is no longer in the store.</Text>
          )}
        </DetailSection>

        {record.claims && Object.keys(record.claims).length > 0 && (
          <DetailSection
            title="Claims"
            accentColor={accentColor}
            badge={Object.keys(record.claims).length}
          >
            {Object.entries(record.claims).map(([k, v]) => (
              <InfoRow
                key={k}
                label={k}
                value={typeof v === "object" ? JSON.stringify(v) : String(v)}
              />
            ))}
          </DetailSection>
        )}

        {disclosures.length > 0 && (
          <DetailSection
            title="Selective Disclosures"
            accentColor={accentColor}
            badge={disclosures.length}
          >
            <Text style={styles.disclosureNote}>
              Each disclosure can be revealed or withheld independently when presenting this SD-JWT
              VC to a verifier.
            </Text>
            {disclosures.map((d, i) => (
              <InfoRow
                key={d.name ?? i}
                label={d.name ?? `[${i}]`}
                value={typeof d.value === "object" ? JSON.stringify(d.value) : String(d.value)}
              />
            ))}
          </DetailSection>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA" },
  scroll: { padding: 20, paddingTop: 10, paddingBottom: 40 },
  empty: { fontSize: 13, color: "#999", paddingVertical: 8 },
  disclosureNote: { fontSize: 12, color: "#8E8E93", lineHeight: 18, paddingBottom: 8 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  missingText: { fontSize: 16, color: "#666" },
});
