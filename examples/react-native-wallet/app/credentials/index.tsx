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
import { useState } from "react";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Link } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useProvider, useCredentials, useIdentities, useRootColors } from "@/hooks/useProvider";
import { issueSampleCredential } from "@/lib/sample-credential";
import { HeaderCard, DetailSection, InfoRow } from "@/components";

const ACCENT = "#FF9500";

export default function Credentials() {
  const { credential } = useProvider();
  const credentials = useCredentials();
  const identities = useIdentities();
  const { colorFor } = useRootColors();
  const [issuing, setIssuing] = useState(false);

  const digitalSupported = credential.digital.isSupported();
  const registrySupported = credential.digitalProvider.isSupported();

  const handleSelfIssue = async () => {
    const holder = identities[0];
    if (!holder) {
      Alert.alert(
        "No Identity",
        "Credentials are bound to an identity holder. Generate one on the Identities page first.",
      );
      return;
    }
    setIssuing(true);
    try {
      await issueSampleCredential(credential.store, holder);
    } catch (error: any) {
      Alert.alert("Failed to issue sample credential", error.message);
    } finally {
      setIssuing(false);
    }
  };

  const handleRemoveCredential = async (id: string) => {
    try {
      await credential.store.removeCredential(id);
    } catch (error: any) {
      console.error("Failed to remove credential", error);
    }
  };

  /** Color-code a credential by the seed/root of its holder identity's key. */
  const colorForCredential = (identityAddress: string) => {
    const holder = identities.find((i) => i.address === identityAddress);
    return colorFor(holder?.metadata?.keyId as string | undefined);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <HeaderCard
          label="Credentials Extension"
          title={credentials.length}
          icon="card-account-details"
          accentColor={ACCENT}
          actions={[
            {
              label: "Self-Issue",
              icon: "card-plus-outline",
              onPress: handleSelfIssue,
              disabled: issuing,
            },
            {
              label: "Clear All",
              icon: "delete-sweep-outline",
              onPress: () => credential.store.clear(),
            },
          ]}
        />

        <Text style={styles.sectionTitle}>Credentials</Text>
        {credentials.length === 0 ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No credentials held.</Text>
            <Text style={styles.emptyStateSubtext}>
              Self-issue a sample SD-JWT VC bound to one of your identities.
            </Text>
          </Animated.View>
        ) : (
          credentials.map((item, i) => {
            const rootColor = colorForCredential(item.identityAddress);
            return (
              <Animated.View
                key={item.id || i}
                entering={FadeIn.duration(300)}
                exiting={FadeOut.duration(300)}
                layout={LinearTransition.springify()}
              >
                <Link href={`/credentials/${item.id}`} asChild>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={[styles.credentialCard, { borderLeftColor: rootColor }]}
                  >
                    <View style={styles.credentialInfo}>
                      <View
                        style={[
                          styles.credentialIconContainer,
                          { backgroundColor: `${rootColor}1F` },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="card-account-details-outline"
                          size={24}
                          color={rootColor}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.credentialName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text
                          style={styles.credentialHolder}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {item.identityAddress}
                        </Text>
                        <Text style={[styles.credentialFormatLabel, { color: rootColor }]}>
                          {item.format}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.credentialActions}>
                      <TouchableOpacity onPress={() => handleRemoveCredential(item.id)} hitSlop={8}>
                        <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </Link>
              </Animated.View>
            );
          })
        )}

        <Text style={styles.sectionTitle}>Digital Credentials API</Text>
        <DetailSection title="Platform Status" accentColor={ACCENT}>
          <InfoRow
            label="Requester (get/create)"
            value={digitalSupported ? "Supported" : "Unavailable on this platform"}
          />
          <InfoRow
            label="Wallet registry"
            value={
              registrySupported
                ? credentials.length > 0
                  ? `Registered (${credentials.length})`
                  : "Available (nothing registered)"
                : "Unavailable on this platform"
            }
          />
          <Text style={styles.digitalNote}>
            {registrySupported
              ? "Stored SD-JWT VCs are mirrored into the Android Credential Manager registry " +
                "(the module bundled with @algorandfoundation/react-native-credentials) and surface in the platform credential " +
                "chooser. Picking one routes the verifier's OpenID4VP request back to this " +
                "wallet, which answers with a key-bound selective disclosure — try it against " +
                "the use-wallet-client example. The requester seam " +
                "(provider.credential.digital) remains a stub on React Native."
              : "The W3C Digital Credentials API seams are attached at " +
                "provider.credential.digital (requester) and provider.credential.digitalProvider " +
                "(wallet registry). The registry needs the bundled Digital Credentials " +
                "native module and Android with Google Play services; the requester side is " +
                "an explicit unsupported stub on React Native."}
          </Text>
        </DetailSection>
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
  credentialCard: {
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
  credentialInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  credentialIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFF4E5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  credentialName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  credentialHolder: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 2,
  },
  credentialFormatLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  credentialActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: "#999",
    marginTop: 4,
    textAlign: "center",
  },
  digitalNote: {
    fontSize: 12,
    color: "#8E8E93",
    lineHeight: 18,
    paddingVertical: 8,
  },
});
