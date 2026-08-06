import { Text, View, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import type { KeyStoreCapability } from "@algorandfoundation/keystore";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * UI descriptor for a keystore algorithm: a friendly label, an icon, and a short
 * description, keyed by the algorithm identifier the keystore reports in
 * `KeyStoreState.algorithms`.
 */
interface AlgorithmMeta {
  label: string;
  icon: IconName;
  description: string;
}

const ALGORITHM_META: Record<string, AlgorithmMeta> = {
  // Shim add-ons
  "BIP32-Ed25519": {
    label: "BIP32-Ed25519",
    icon: "key-chain",
    description: "Hierarchical deterministic Ed25519 keys",
  },
  "Falcon-1024": {
    label: "Falcon-1024",
    icon: "atom-variant",
    description: "Post-quantum lattice signatures",
  },
  "Deterministic-P256": {
    label: "Deterministic P-256",
    icon: "fingerprint",
    description: "Passkey / WebAuthn key derivation",
  },
  BIP39: {
    label: "BIP39",
    icon: "text-short",
    description: "Mnemonic seed phrases",
  },
  Algo25: {
    label: "Algo25",
    icon: "alphabetical-variant",
    description: "Algorand 25-word seeds",
  },
  // Host (native Subtle) algorithms
  Ed25519: {
    label: "Ed25519",
    icon: "signature-freehand",
    description: "Native EdDSA signatures",
  },
  ECDSA: {
    label: "ECDSA",
    icon: "sine-wave",
    description: "Native elliptic-curve signatures",
  },
  ECDH: {
    label: "ECDH",
    icon: "swap-horizontal",
    description: "Native elliptic-curve key agreement",
  },
  "RSASSA-PKCS1-v1_5": {
    label: "RSA (RS256)",
    icon: "lock",
    description: "Native RSA signatures",
  },
  "AES-GCM": {
    label: "AES-GCM",
    icon: "shield-lock",
    description: "Native authenticated encryption",
  },
};

function metaFor(algorithm: string): AlgorithmMeta {
  return (
    ALGORITHM_META[algorithm] ?? {
      label: algorithm,
      icon: "shield-key-outline",
      description: "Cryptographic algorithm",
    }
  );
}

function CapabilityRow({
  capability,
  accentColor,
}: {
  capability: KeyStoreCapability;
  accentColor: string;
}) {
  const meta = metaFor(capability.algorithm);
  return (
    <View style={styles.card}>
      <View style={[styles.iconContainer, { backgroundColor: `${accentColor}15` }]}>
        <MaterialCommunityIcons name={meta.icon} size={20} color={accentColor} />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.label}>{meta.label}</Text>
        <Text style={styles.description}>{meta.description}</Text>
      </View>
      <Text style={styles.algorithmId}>{capability.algorithm}</Text>
    </View>
  );
}

export interface CapabilityListProps {
  /** Tagged capabilities from `KeyStoreState.algorithms`. */
  capabilities: KeyStoreCapability[];
  /** Accent color used for icons. */
  accentColor?: string;
}

/**
 * Displays the keystore's cryptographic capabilities, grouped by source: the
 * composable **shim** add-ons layered over the host, and the standard **host**
 * (native Subtle) algorithms. The shim list reflects what the engine resolved at
 * runtime, so an optional add-on (e.g. the native Falcon-1024 binding) only
 * appears when it is actually available.
 */
export function CapabilityList({ capabilities, accentColor = "#007AFF" }: CapabilityListProps) {
  if (capabilities.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No cryptographic capabilities active yet.</Text>
      </View>
    );
  }

  const shims = capabilities.filter((c) => c.source === "shim");
  const host = capabilities.filter((c) => c.source === "host");

  return (
    <View>
      {shims.length > 0 && (
        <>
          <Text style={styles.groupTitle}>Shim add-ons</Text>
          {shims.map((c) => (
            <CapabilityRow key={c.algorithm} capability={c} accentColor={accentColor} />
          ))}
        </>
      )}
      {host.length > 0 && (
        <>
          <Text style={styles.groupTitle}>Native (Subtle)</Text>
          {host.map((c) => (
            <CapabilityRow key={c.algorithm} capability={c} accentColor="#8E8E93" />
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  groupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  description: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  algorithmId: {
    fontSize: 10,
    color: "#B0B0B0",
    marginLeft: 8,
  },
  empty: {
    padding: 16,
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    borderRadius: 12,
    marginBottom: 12,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#CCC",
  },
  emptyText: {
    color: "#999",
  },
});
