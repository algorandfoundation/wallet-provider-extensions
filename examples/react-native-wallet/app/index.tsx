import {
  Alert,
  Text,
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  useKeys,
  useAccounts,
  useIdentities,
  useConnections,
  useCredentials,
  usePasskeys,
  useProvider,
} from "@/hooks/useProvider";
import { useMigrations } from "@/hooks/useMigrations";
import { HeaderCard, ExtensionCard, QrScannerModal } from "@/components";
import type { ExtensionCardProps } from "@/components";
import { classifyScannedPayload } from "@/lib/scan";
import { isAlgorandAccount } from "@algorandfoundation/algorand-accounts-extension";

type IconName = ExtensionCardProps["icon"];

interface DomainExtension extends Omit<ExtensionCardProps, "index"> {
  packages: string[];
}

interface Domain {
  key: string;
  title: string;
  icon: IconName;
  color: string;
  description: string;
  extensions: DomainExtension[];
}

export default function Index() {
  const { pending: migrationsPending, error: migrationsError } = useMigrations();
  const router = useRouter();
  const provider = useProvider();
  const keys = useKeys();
  const accounts = useAccounts();
  const identities = useIdentities();
  const credentials = useCredentials();
  const connections = useConnections();
  const passkeys = usePasskeys();
  const [scanning, setScanning] = useState(false);

  // Generic scanner: recognize the payload while the viewfinder is open so
  // unknown QR codes are rejected in place instead of failing after dismiss.
  const validateScan = useCallback(
    (data: string) =>
      classifyScannedPayload(data) ? null : "Not a FIDO passkey or liquid:// connection QR code.",
    [],
  );

  const handleScanned = useCallback(
    (data: string) => {
      setScanning(false);
      const payload = classifyScannedPayload(data);
      if (!payload) return;
      if (payload.kind === "fido") {
        // Hand the hybrid (caBLE) QR to the OS: Google Play services runs the
        // tunnel + BLE proximity check and serves the assertion through
        // Credential Manager — this wallet's provider, when it is enabled.
        Linking.openURL(payload.data).catch(() => {
          Alert.alert(
            "Cross-device sign-in unavailable",
            "No system handler for FIDO QR codes was found on this device (Google Play services is required).",
          );
        });
        return;
      }
      // liquid:// — hand off to the Connections screen, which auto-accepts.
      router.push({ pathname: "/connections", params: { uri: payload.data } });
    },
    [router],
  );

  if (migrationsPending) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (migrationsError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ fontWeight: "bold", marginBottom: 8 }}>Migration failed</Text>
        <Text>{migrationsError.message}</Text>
      </View>
    );
  }

  const domains: Domain[] = [
    {
      key: "keystore",
      title: "Keystore",
      icon: "key-variant",
      color: "#007AFF",
      description: "Seeds, root keys, and derived keys.",
      extensions: [
        {
          title: "Keys",
          count: keys.length,
          icon: "key",
          color: "#007AFF",
          href: "/keys",
          packages: ["@algorandfoundation/keystore", "@algorandfoundation/react-native-keystore"],
          substats: [
            {
              label: "Base",
              count: keys.filter((k) => k.type === "hd-seed" || k.type === "hd-root-key").length,
            },
            {
              label: "Derived",
              count: keys.filter((k) => k.type === "hd-derived-ed25519").length,
            },
          ],
        },
      ],
    },
    {
      key: "accounts",
      title: "Accounts",
      icon: "account-group",
      color: "#34C759",
      description: "Managed and watched on-chain accounts.",
      extensions: [
        {
          title: "Accounts",
          count: accounts.length,
          icon: "account-group",
          color: "#34C759",
          href: "/accounts",
          packages: [
            "@algorandfoundation/accounts",
            "@algorandfoundation/accounts-core",
            "@algorandfoundation/accounts-keystore-extension",
            "@algorandfoundation/algorand-accounts-extension",
          ],
          substats: [
            {
              label: "Managed",
              count: accounts.filter((a) => a.type === "keystore-account").length,
            },
            {
              label: "Algorand",
              count: accounts.filter((a) => isAlgorandAccount(a)).length,
            },
            {
              // Post-quantum Falcon accounts (keystore accounts whose
              // backing key is a falcon-1024 key).
              label: "Falcon",
              count: accounts.filter(
                (a) =>
                  a.type === "keystore-account" &&
                  (a.metadata as { keyType?: string } | undefined)?.keyType === "falcon-1024",
              ).length,
            },
            {
              label: "Watched",
              count: accounts.filter((a) => a.type === "watched").length,
            },
          ],
        },
      ],
    },
    {
      key: "identities",
      title: "Identities",
      icon: "shield-account",
      color: "#5856D6",
      description: "Decentralized identifiers and DID documents.",
      extensions: [
        {
          title: "Identities",
          count: identities.length,
          icon: "shield-account",
          color: "#5856D6",
          href: "/identities",
          packages: ["@algorandfoundation/identities", "@algorandfoundation/identities-core"],
          substats: [
            { label: "Active", count: identities.length },
            {
              label: "DIDs",
              count: identities.filter((i) => i.didDocument).length,
            },
          ],
        },
      ],
    },
    {
      key: "credentials",
      title: "Credentials",
      icon: "card-account-details",
      color: "#FF9500",
      description: "Verifiable Credentials and the Digital Credentials API seam.",
      extensions: [
        {
          title: "Credentials",
          count: credentials.length,
          icon: "card-account-details",
          color: "#FF9500",
          href: "/credentials",
          packages: [
            "@algorandfoundation/credentials",
            "@algorandfoundation/react-native-credentials",
            "@algorandfoundation/credentials-core",
          ],
          substats: [
            {
              label: "SD-JWT",
              count: credentials.filter((c) => c.format === "vc+sd-jwt").length,
            },
            { label: "Held", count: credentials.length },
          ],
        },
      ],
    },
    {
      key: "connections",
      title: "Connections",
      icon: "connection",
      color: "#2CD3E1",
      description: "Remote dapp connections over the Liquid Auth protocol.",
      extensions: [
        {
          title: "Connections",
          count: connections.length,
          icon: "connection",
          color: "#2CD3E1",
          href: "/connections",
          packages: [
            "@algorandfoundation/connections",
            "@algorandfoundation/react-native-connections",
            "@algorandfoundation/connections-liquid-auth",
          ],
          substats: [
            {
              label: "Connected",
              count: connections.filter((s) => s.status === "connected").length,
            },
            { label: "Sessions", count: connections.length },
          ],
        },
      ],
    },
    {
      key: "passkeys",
      title: "Passkeys",
      icon: "key-chain",
      color: "#AF52DE",
      description: "Passkeys served by this wallet's credential provider.",
      extensions: [
        {
          title: "Passkeys",
          count: passkeys.length,
          icon: "key-chain",
          color: "#AF52DE",
          href: "/passkeys",
          packages: [
            "@algorandfoundation/react-native-passkeys",
            "@algorandfoundation/passkeys-core",
            "@algorandfoundation/react-native-passkey-autofill",
          ],
          substats: [
            {
              label: "Server-known",
              count: passkeys.filter((p) => p.serverStatus === "known").length,
            },
            { label: "Stored", count: passkeys.length },
          ],
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <HeaderCard
          label="Powered by Provider Extensions"
          title={provider.name}
          icon="shield-lock"
          accentColor="#5856D6"
          description="Modular wallet runtime showcasing keystore, account, identity, and credential extensions working together."
          actions={[
            {
              label: "Scan QR",
              icon: "qrcode-scan",
              onPress: () => setScanning(true),
            },
          ]}
        />

        <Text style={styles.sectionTitle}>Available Extensions</Text>

        {domains.map((domain, domainIndex) => (
          <View key={domain.key} style={styles.domainBlock}>
            <View style={styles.domainHeader}>
              <View style={[styles.domainIcon, { backgroundColor: `${domain.color}15` }]}>
                <Text style={[styles.domainIconText, { color: domain.color }]}>
                  {domain.title.charAt(0)}
                </Text>
              </View>
              <View style={styles.domainHeaderText}>
                <Text style={styles.domainTitle}>{domain.title}</Text>
                <Text style={styles.domainDescription}>{domain.description}</Text>
              </View>
              <View style={[styles.domainBadge, { backgroundColor: `${domain.color}15` }]}>
                <Text style={[styles.domainBadgeText, { color: domain.color }]}>
                  {domain.extensions[0]?.packages.length ?? 0} pkg
                </Text>
              </View>
            </View>

            <View style={styles.packagesRow}>
              {domain.extensions[0]?.packages.map((pkg) => (
                <View key={pkg} style={styles.packageChip}>
                  <Text style={styles.packageText} numberOfLines={1}>
                    {pkg.replace("@algorandfoundation/", "")}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {domain.extensions.map((ext, i) => (
                <ExtensionCard
                  key={ext.title}
                  title={ext.title}
                  count={ext.count}
                  icon={ext.icon}
                  color={ext.color}
                  href={ext.href}
                  substats={ext.substats}
                  index={domainIndex + i}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <QrScannerModal
        visible={scanning}
        title="Scan a QR code"
        hint="Works with a browser's FIDO passkey QR (cross-device sign-in) and liquid:// connection QR codes."
        validate={validateScan}
        onScanned={handleScanned}
        onClose={() => setScanning(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  domainBlock: {
    marginBottom: 20,
  },
  domainHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  domainIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  domainIconText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  domainHeaderText: {
    flex: 1,
  },
  domainTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1A1A1A",
  },
  domainDescription: {
    fontSize: 12,
    color: "#666",
    marginTop: 1,
  },
  domainBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  domainBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  packagesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  packageChip: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  packageText: {
    fontSize: 11,
    color: "#555",
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
  },
});
