import {
    Text,
    View,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    ScrollView,
    StatusBar,
    Alert
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {useProvider} from "@/hooks/useProvider";
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link } from "expo-router";
import { useState, useEffect } from "react";
import { useSeedColors } from "@/hooks/useSeedColors";

const ROOT_COLORS = ['#007AFF', '#34C759', '#5856D6', '#AF52DE', '#FF9500', '#FF3B30', '#FFCC00', '#5AC8FA'];

export default function Passkeys() {
    const {passkeys, status, passkey, keys, key, accounts} = useProvider();
    const [activeSeed, setActiveSeed] = useState<string | null>(null);
    const [activeAccount, setActiveAccount] = useState<string | null>(null);

    const rootKeyColors = useSeedColors(keys);

    const seeds = keys.filter(k => k.type === 'hd-seed');
    const rootKeys = keys.filter(k => k.type === 'hd-root-key');

    useEffect(() => {
        if (rootKeys.length > 0) {
            if (!activeSeed || !rootKeys.some(k => k.id === activeSeed)) {
                setActiveSeed(rootKeys[0].id);
            }
        } else if (seeds.length > 0) {
            if (!activeSeed || !seeds.some(k => k.id === activeSeed)) {
                setActiveSeed(seeds[0].id);
            }
        } else if (activeSeed !== null) {
            setActiveSeed(null);
        }
    }, [rootKeys, seeds, activeSeed]);

    useEffect(() => {
        if (accounts.length > 0) {
            if (!activeAccount || !accounts.some(a => a.address === activeAccount)) {
                setActiveAccount(accounts[0].address);
            }
        } else if (activeAccount !== null) {
            setActiveAccount(null);
        }
    }, [accounts, activeAccount]);

    const handleGeneratePasskey = async () => {
        if(!activeSeed) {
            Alert.alert('No Seed Selected', 'Please import or select a seed first');
            return;
        }

        if(!activeAccount) {
            Alert.alert('No Account Selected', 'Please create an account first');
            return;
        }

        try {
            const keyId = await key.store.generate({
                type: 'hd-derived-passkey',
                algorithm: 'P256', // Example algorithm
                extractable: true,
                keyUsages: ['sign', 'verify'],
                params: {
                    parentKeyId: activeSeed,
                    origin: 'https://example.com',
                    userHandle: activeAccount,
                }
            });

            // The passkey store bridge (WithPasskeysKeystore) should automatically pick this up
            console.log('Generated key for passkey:', keyId);
        } catch (error: any) {
            Alert.alert('Generation Failed', error.message);
        }
    }

    const handleRemovePasskey = async (id: string) => {
        try {
            await passkey.store.removePasskey(id);
        } catch (error: any) {
            console.error("Failed to remove passkey", error);
        }
    }

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <Animated.View entering={FadeIn.duration(300)} style={styles.header}>
                <View>
                    <Text style={styles.welcomeText}>Manage Passkeys</Text>
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
                            <Text style={styles.balanceLabel}>Total Passkeys</Text>
                            <Text style={styles.balanceAmount}>{passkeys.length}</Text>
                            <View style={styles.actionButtons}>
                                <TouchableOpacity
                                    style={[styles.actionButton, status === 'computing' && {opacity: 0.5}]}
                                    onPress={handleGeneratePasskey}
                                    disabled={status !== 'idle'}
                                >
                                    <View style={[styles.iconCircle, {backgroundColor: '#FFFFFF'}]}>
                                        <MaterialCommunityIcons name="plus-circle-outline" size={24} color="#007AFF" />
                                    </View>
                                    <Text style={styles.actionText}>Generate</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.actionButton} onPress={() => passkey.store.clear()} disabled={status !== 'idle'}>
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
                            <View style={[styles.navButton, styles.activeNavButton]}>
                                <MaterialCommunityIcons name="fingerprint" size={20} color="#FFF" />
                            </View>
                            <Link href="/connections" asChild>
                                <TouchableOpacity style={styles.navButton}>
                                    <MaterialCommunityIcons name="link-variant" size={20} color="#007AFF" />
                                </TouchableOpacity>
                            </Link>
                        </View>
                    </View>
                </View>

                <Animated.Text entering={FadeIn.delay(200).duration(300)} style={styles.sectionTitle}>Passkeys</Animated.Text>
                {passkeys.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No passkeys found.</Text>
                    </Animated.View>
                ) : (
                    passkeys.map((item, i) => {
                        const parentColor = rootKeyColors[item.metadata?.parentKeyId as string] || '#007AFF';
                        return (
                            <Animated.View
                                key={item.id || i}
                                entering={FadeIn.duration(150)}
                                exiting={FadeOut.duration(150)}
                                layout={LinearTransition.springify()}
                            >
                                <View style={styles.passkeyCard}>
                                    <View style={styles.passkeyInfo}>
                                        <View style={[styles.passkeyIconContainer, { backgroundColor: `${parentColor}15` }]}>
                                            <MaterialCommunityIcons
                                                name="fingerprint"
                                                size={24}
                                                color={parentColor}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.passkeyName, { color: parentColor }]} numberOfLines={1}>
                                                {item.name || 'Unnamed Passkey'}
                                            </Text>
                                            <Text style={styles.passkeyId} numberOfLines={1} ellipsizeMode="middle">
                                                {item.id}
                                            </Text>
                                            {item.metadata?.userHandle && (
                                                <Text style={styles.passkeyMetadata} numberOfLines={1} ellipsizeMode="middle">Handle: {item.metadata.userHandle}</Text>
                                            )}
                                        </View>
                                    </View>
                                    <View style={styles.passkeyActions}>
                                        <TouchableOpacity onPress={() => handleRemovePasskey(item.id)}>
                                            <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </Animated.View>
                        );
                    })
                )}

                <Animated.Text entering={FadeIn.delay(200).duration(300)} style={styles.sectionTitle}>Accounts</Animated.Text>
                {accounts.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No accounts found. Create one in Accounts view.</Text>
                    </Animated.View>
                ) : (
                    accounts.map((item, i) => {
                        const parentColor = rootKeyColors[item.metadata?.parentKeyId as string] || '#8E8E93';
                        const isActive = activeAccount === item.address;
                        return (
                            <Animated.View
                                key={item.address || i}
                                entering={FadeIn.duration(150)}
                                exiting={FadeOut.duration(150)}
                                layout={LinearTransition.springify()}
                            >
                                <TouchableOpacity
                                    style={[
                                        styles.accountCard,
                                        isActive && styles.activeAccountCard,
                                        isActive && { borderColor: parentColor }
                                    ]}
                                    onPress={() => setActiveAccount(item.address)}
                                >
                                    <View style={styles.accountInfo}>
                                        <View style={[
                                            styles.accountIconContainer,
                                            { backgroundColor: `${parentColor}15` }
                                        ]}>
                                            <MaterialCommunityIcons
                                                name="account"
                                                size={24}
                                                color={isActive ? parentColor : `${parentColor}80`}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[
                                                styles.accountAddress,
                                                { color: isActive ? parentColor : '#1A1A1A', fontWeight: isActive ? 'bold' : '500' }
                                            ]} numberOfLines={1} ellipsizeMode="middle">
                                                {item.address}
                                            </Text>
                                            {item.metadata?.name && (
                                                <Text style={styles.accountMetadata}>{item.metadata.name}</Text>
                                            )}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </Animated.View>
                        );
                    })
                )}

                <Animated.Text entering={FadeIn.delay(150).duration(200)} style={[styles.sectionTitle, { marginTop: 20 }]}>Root Keys</Animated.Text>
                {rootKeys.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No root keys yet.</Text>
                    </Animated.View>
                ) : (
                    rootKeys.map((item, i) => {
                        const rootColor = rootKeyColors[item.id] || '#666';
                        return (
                            <Animated.View
                                key={item.id || i}
                                entering={FadeIn.duration(150)}
                                exiting={FadeOut.duration(150)}
                                layout={LinearTransition.springify()}
                            >
                                <TouchableOpacity
                                    style={[
                                        styles.keyCard,
                                        activeSeed === item.id && styles.activeKeyCard,
                                        activeSeed === item.id && { borderColor: rootColor }
                                    ]}
                                    onPress={() => setActiveSeed(item.id)}
                                >
                                    <View style={styles.keyInfo}>
                                        <View style={[
                                            styles.keyIconContainer,
                                            { backgroundColor: `${rootColor}15` }
                                        ]}>
                                            <MaterialCommunityIcons
                                                name="key-chain"
                                                size={20}
                                                color={activeSeed === item.id ? rootColor : `${rootColor}80`}
                                            />
                                        </View>
                                        <View>
                                            <Text style={[
                                                styles.keyType,
                                                activeSeed === item.id && styles.activeKeyType,
                                                activeSeed === item.id && { color: rootColor }
                                            ]}>
                                                {item.type}
                                            </Text>
                                            <Text style={styles.keyAddress}>{item.algorithm}</Text>
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </Animated.View>
                        );
                    })
                )}

                <Animated.Text entering={FadeIn.delay(200).duration(200)} style={[styles.sectionTitle, { marginTop: 20 }]}>Seeds</Animated.Text>
                {seeds.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No seeds yet.</Text>
                    </Animated.View>
                ) : (
                    seeds.map((item, i) => {
                        const rootColor = rootKeyColors[item.id] || '#666';
                        return (
                            <Animated.View
                                key={item.id || i}
                                entering={FadeIn.duration(150)}
                                exiting={FadeOut.duration(150)}
                                layout={LinearTransition.springify()}
                            >
                                <TouchableOpacity
                                    style={[
                                        styles.keyCard,
                                        activeSeed === item.id && styles.activeKeyCard,
                                        activeSeed === item.id && { borderColor: rootColor }
                                    ]}
                                    onPress={() => setActiveSeed(item.id)}
                                >
                                    <View style={styles.keyInfo}>
                                        <View style={[
                                            styles.keyIconContainer,
                                            { backgroundColor: `${rootColor}15` }
                                        ]}>
                                            <MaterialCommunityIcons
                                                name="seed-outline"
                                                size={20}
                                                color={activeSeed === item.id ? rootColor : `${rootColor}80`}
                                            />
                                        </View>
                                        <View>
                                            <Text style={[
                                                styles.keyType,
                                                activeSeed === item.id && styles.activeKeyType,
                                                activeSeed === item.id && { color: rootColor }
                                            ]}>
                                                {item.type}
                                            </Text>
                                            <Text style={styles.keyAddress}>{item.algorithm}</Text>
                                        </View>
                                    </View>
                                </TouchableOpacity>
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
    accountCard: {
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
    activeAccountCard: {
        borderColor: '#007AFF',
        backgroundColor: '#F0F7FF',
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
        backgroundColor: '#F2F2F7',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    accountAddress: {
        fontSize: 15,
        color: '#1A1A1A',
        fontWeight: '500',
    },
    accountMetadata: {
        fontSize: 12,
        color: '#8E8E93',
        marginTop: 2,
    },
    passkeyCard: {
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
    passkeyInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    passkeyIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F2F2F7',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    passkeyName: {
        fontSize: 16,
        color: '#1A1A1A',
        fontWeight: '600',
    },
    passkeyId: {
        fontSize: 12,
        color: '#8E8E93',
        marginTop: 2,
    },
    passkeyMetadata: {
        fontSize: 10,
        color: '#8E8E93',
        marginTop: 2,
    },
    passkeyActions: {
        marginLeft: 12,
    },
    keyCard: {
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
    activeKeyCard: {
        borderColor: '#007AFF',
        backgroundColor: '#F0F7FF',
    },
    keyInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    keyIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F2F2F7',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    keyType: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#8E8E93',
        marginBottom: 2,
    },
    activeKeyType: {
        color: '#007AFF',
    },
    keyAddress: {
        fontSize: 15,
        color: '#333',
        fontWeight: '500',
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
