import {
    Text,
    View,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    ScrollView,
    StatusBar,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {useProvider} from "@/hooks/useProvider";
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link } from "expo-router";

export default function Accounts() {
    const {accounts, status, account, log} = useProvider();

    const handleRemoveAccount = async (address: string) => {
        try {
            await account.store.removeAccount(address);
        } catch (error: any) {
            log.error("Failed to remove account", { error: error?.message || error }, "App");
        }
    }

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.header}>
                <View>
                    <Text style={styles.welcomeText}>Wallet Accounts</Text>
                    <View style={styles.statusBadge}>
                        <View style={[styles.statusDot, { backgroundColor: status === 'idle' ? '#4CAF50' : status === 'generating' ? '#FF9800' : '#999' }]} />
                        <Text style={styles.statusText}>{status}</Text>
                    </View>
                </View>
                <Link href="/" asChild>
                    <TouchableOpacity style={styles.navButton}>
                        <MaterialCommunityIcons name="key" size={24} color="#007AFF" />
                        <Text style={styles.navButtonText}>Keys</Text>
                    </TouchableOpacity>
                </Link>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.balanceCard}>
                    <Text style={styles.balanceLabel}>Total Accounts</Text>
                    <Text style={styles.balanceAmount}>{accounts.length}</Text>
                    <View style={styles.actionButtons}>
                         <TouchableOpacity style={styles.actionButton} onPress={() => account.store.clear()} disabled={status !== 'idle'}>
                            <View style={[styles.iconCircle, {backgroundColor: '#FFF3E0'}]}>
                                <MaterialCommunityIcons name="delete-sweep-outline" size={24} color="#FF9800" />
                            </View>
                            <Text style={styles.actionText}>Clear All</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Accounts</Text>
                {accounts.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No accounts found.</Text>
                    </Animated.View>
                ) : (
                    accounts.map((item, i) => {
                        return (
                            <Animated.View
                                key={item.address || i}
                                entering={FadeIn.duration(300)}
                                exiting={FadeOut.duration(300)}
                                layout={LinearTransition.springify()}
                            >
                                <View style={styles.accountCard}>
                                    <View style={styles.accountInfo}>
                                        <View style={styles.accountIconContainer}>
                                            <MaterialCommunityIcons
                                                name="account"
                                                size={24}
                                                color="#007AFF"
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.accountAddress} numberOfLines={1} ellipsizeMode="middle">
                                                {item.address}
                                            </Text>
                                            {item.metadata?.name && (
                                                <Text style={styles.accountMetadata}>{item.metadata.name}</Text>
                                            )}
                                        </View>
                                    </View>
                                    <View style={styles.accountActions}>
                                        <TouchableOpacity onPress={() => handleRemoveAccount(item.address)}>
                                            <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
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
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 10,
        marginBottom: 10,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        marginTop: 4,
        alignSelf: 'flex-start',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    statusText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#666',
    },
    welcomeText: {
        fontSize: 14,
        color: '#666',
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    navButtonText: {
        marginLeft: 4,
        color: '#007AFF',
        fontWeight: '600',
    },
    balanceCard: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 24,
        marginBottom: 32,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 14,
        color: '#666',
        marginBottom: 8,
    },
    balanceAmount: {
        fontSize: 36,
        fontWeight: 'bold',
        color: '#1A1A1A',
        marginBottom: 24,
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
    },
    actionButton: {
        alignItems: 'center',
    },
    iconCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#333',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1A1A1A',
        marginBottom: 16,
        marginTop: 8,
    },
    accountCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    accountInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    accountIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F0F7FF',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    accountAddress: {
        fontSize: 16,
        color: '#1A1A1A',
        fontWeight: '600',
        fontFamily: 'System',
    },
    accountMetadata: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    accountActions: {
        marginLeft: 12,
    },
    emptyState: {
        padding: 40,
        alignItems: 'center',
        backgroundColor: '#F0F0F0',
        borderRadius: 20,
        marginBottom: 16,
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: '#CCC',
    },
    emptyStateText: {
        color: '#999',
        fontSize: 16,
    },
});
