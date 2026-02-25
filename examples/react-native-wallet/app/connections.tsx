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

export default function Connections() {
    const {connections, status, connection, walletconnect, liquidAuth} = useProvider();

    const handleDisconnect = async (id: string, metadata?: Record<string, any>) => {
        try {
            if (metadata?.namespaces) {
                // It's a WalletConnect connection
                await walletconnect.disconnect(id);
            } else if (metadata?.channel || id.startsWith('0x') || id.length === 58) {
                // It's likely a Liquid Auth connection (using address as ID)
                await liquidAuth.disconnect(id);
            } else {
                // Fallback to generic removal
                await connection.store.removeConnection(id);
            }
        } catch (error: any) {
            console.error("Failed to disconnect", error);
        }
    }

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <Animated.View entering={FadeIn.duration(300)} style={styles.header}>
                <View>
                    <Text style={styles.welcomeText}>Manage Connections</Text>
                    <View style={styles.statusBadge}>
                        <View style={[styles.statusDot, { backgroundColor: status === 'idle' ? '#4CAF50' : status === 'generating' ? '#FF9800' : '#999' }]} />
                        <Text style={styles.statusText}>{status}</Text>
                    </View>
                </View>
            </Animated.View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View>
                    <View style={styles.balanceCard}>
                        <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center', width: '100%' }}>
                            <Text style={styles.balanceLabel}>Active Connections</Text>
                            <Text style={styles.balanceAmount}>{connections.length}</Text>
                            <View style={styles.actionButtons}>
                                <TouchableOpacity style={styles.actionButton} onPress={() => connection.store.clear()} disabled={status !== 'idle'}>
                                    <View style={[styles.iconCircle, {backgroundColor: '#FFFFFF'}]}>
                                        <MaterialCommunityIcons name="delete-sweep-outline" size={24} color="#FF9800" />
                                    </View>
                                    <Text style={styles.actionText}>Clear All</Text>
                                </TouchableOpacity>
                            </View>
                        </Animated.View>
                    </View>

                    <View style={styles.navGroupContainer}>
                        <View style={styles.navGroup}>
                            <Link href="/" asChild>
                                <TouchableOpacity style={styles.navButton}>
                                    <MaterialCommunityIcons name="key" size={20} color="#007AFF" />
                                </TouchableOpacity>
                            </Link>
                            <Link href="/accounts" asChild>
                                <TouchableOpacity style={styles.navButton}>
                                    <MaterialCommunityIcons name="account-group" size={20} color="#007AFF" />
                                </TouchableOpacity>
                            </Link>
                            <Link href="/passkeys" asChild>
                                <TouchableOpacity style={styles.navButton}>
                                    <MaterialCommunityIcons name="fingerprint" size={20} color="#007AFF" />
                                </TouchableOpacity>
                            </Link>
                            <View style={[styles.navButton, styles.activeNavButton]}>
                                <MaterialCommunityIcons name="link-variant" size={20} color="#FFF" />
                            </View>
                        </View>
                    </View>
                </View>

                <Animated.Text entering={FadeIn.delay(200).duration(300)} style={styles.sectionTitle}>Connections</Animated.Text>
                {connections.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No active connections.</Text>
                    </Animated.View>
                ) : (
                    connections.map((item, i) => {
                        const isWC = !!item.metadata?.namespaces;
                        const isLiquid = !isWC && !!(item as any).channel;

                        return (
                            <Animated.View
                                key={item.id || i}
                                entering={FadeIn.duration(150)}
                                exiting={FadeOut.duration(150)}
                                layout={LinearTransition.springify()}
                            >
                                <View style={styles.connectionCard}>
                                    <View style={styles.connectionInfo}>
                                        <View style={[styles.connectionIconContainer, { backgroundColor: isWC ? '#F0F0FF' : isLiquid ? '#F0FFF0' : '#F7F7F7' }]}>
                                            <MaterialCommunityIcons
                                                name={isWC ? "link-variant" : isLiquid ? "water" : "connection"}
                                                size={24}
                                                color={isWC ? "#3399FF" : isLiquid ? "#4CAF50" : "#666"}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.connectionName} numberOfLines={1}>
                                                {item.name || 'Unknown Connection'}
                                            </Text>
                                            <Text style={styles.connectionId} numberOfLines={1} ellipsizeMode="middle">
                                                {isWC ? `WC: ${item.id.slice(0, 8)}...` : item.id}
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.connectionActions}>
                                        <TouchableOpacity onPress={() => handleDisconnect(item.id, item.metadata)}>
                                            <MaterialCommunityIcons name="link-off" size={24} color="#FF3B30" />
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
        backgroundColor: "#FFFFFF",
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
        backgroundColor: '#F2F2F7',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        marginTop: 4,
        alignSelf: 'flex-start',
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
        color: '#8E8E93',
    },
    welcomeText: {
        fontSize: 14,
        color: '#8E8E93',
    },
    navGroupContainer: {
        alignItems: 'center',
        marginBottom: 24,
    },
    navGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F2F2F7',
        borderRadius: 20,
        padding: 4,
    },
    navButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 18,
    },
    activeNavButton: {
        backgroundColor: '#007AFF',
    },
    navButtonText: {
        marginLeft: 4,
        color: '#007AFF',
        fontWeight: '600',
    },
    balanceCard: {
        backgroundColor: '#F2F2F7',
        borderRadius: 24,
        padding: 24,
        marginBottom: 32,
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 14,
        color: '#8E8E93',
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
        backgroundColor: '#FFFFFF',
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
    connectionCard: {
        backgroundColor: '#FFFFFF',
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
        borderWidth: 1,
        borderColor: '#F2F2F7',
    },
    connectionInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    connectionIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    connectionName: {
        fontSize: 16,
        color: '#1A1A1A',
        fontWeight: '600',
    },
    connectionId: {
        fontSize: 12,
        color: '#8E8E93',
        marginTop: 2,
    },
    connectionActions: {
        marginLeft: 12,
    },
    emptyState: {
        padding: 40,
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#F2F2F7',
    },
    emptyStateText: {
        color: '#8E8E93',
        fontSize: 16,
    },
});
