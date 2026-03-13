import {
    Text,
    View,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    ScrollView,
    StatusBar,
    ActivityIndicator,
    Alert
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {useProvider} from "@/hooks/useProvider";
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {randomBytes} from "react-native-quick-crypto";
import {useState, useEffect} from "react";
import { Link } from "expo-router";

// No LayoutAnimation needed anymore
const ROOT_COLORS = ['#007AFF', '#34C759', '#5856D6', '#AF52DE', '#FF9500', '#FF3B30', '#FFCC00', '#5AC8FA'];

export default function Index() {
    const {keys, key, status, log} = useProvider();

    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [activeSeed, setActiveSeed] = useState<string | null>(null);
    const [activeRootKey, setActiveRootKey] = useState<string | null>(null);

    const seeds = keys.filter(k => k.type === 'hd-seed');
    const rootKeys = keys.filter(k => k.type === 'hd-root-key');
    const derivedKeys = keys.filter(k => k.type !== 'hd-seed' && k.type !== 'hd-root-key');
    
    // Stable color mapping based on root hierarchy
    const allRootKeys = [...seeds, ...rootKeys];
    const rootKeyColors = allRootKeys.reduce((acc, rootKey) => {
        // Find the top-most parent (the seed) for this root key to ensure consistent coloring
        // Root keys might have parentKeyId or rootKeyId in metadata depending on how they were created
        const seedId = rootKey.type === 'hd-root-key' 
            ? (rootKey.metadata?.parentKeyId || rootKey.metadata?.rootKeyId || rootKey.metadata?.parentId || rootKey.id) as string
            : rootKey.id;
        
        // Simple hash function for string ID
        let hash = 0;
        const idToHash = seedId || rootKey.id;
        for (let i = 0; i < idToHash.length; i++) {
            const char = idToHash.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        acc[rootKey.id] = ROOT_COLORS[Math.abs(hash) % ROOT_COLORS.length];
        return acc;
    }, {} as Record<string, string>);

    // Effect to set the first root key as active if the current active seed is removed
    useEffect(() => {
        if (rootKeys.length > 0) {
            // Check if activeSeed is null or if it no longer exists in rootKeys
            if (!activeSeed || !rootKeys.some(k => k.id === activeSeed)) {
                setActiveSeed(rootKeys[0].id);
            }
        } else if (seeds.length > 0) {
            // Fallback to seeds if no root keys
            if (!activeSeed || !seeds.some(k => k.id === activeSeed)) {
                setActiveSeed(seeds[0].id);
            }
        } else if (activeSeed !== null) {
            setActiveSeed(null);
        }
    }, [rootKeys, seeds, activeSeed]);

    const handleAddKey = async () => {
        if(!activeSeed) {
            Alert.alert('No Seed Selected', 'Please import a seed');
            return;
        }
        // Pick the next available index for the derived key
        const nextIndex = keys.filter(k => k.type === 'hd-derived-ed25519' && k?.metadata?.parentKeyId === activeSeed).length;
        log.info('Next index: ' + nextIndex, { keys: keys.filter(k => k.type === 'hd-derived-ed25519') }, 'App');
        const keyId = await key.store.generate({
            type: 'hd-derived-ed25519',
            algorithm: 'EdDSA',
            extractable: true,
            keyUsages: ['sign', "verify"],
            params: {
                parentKeyId: activeSeed,
                context: 0,
                account: 0,
                index: nextIndex,
                derivation: 9
            }
        })

        setActiveKey(keyId);
    };

    const handleImportSeed = async () => {


        // When the format is raw, the key should be the raw privateKey. When the format is seed, it should be the seed to be imported and create the ed25519 key with
        const keyId = await key.store.import(new Uint8Array(randomBytes(64)), 'ed25519', 'seed')
        // When the format is raw, the key should be the raw privateKey. When the format is seed, it should be the seed to be imported and create the root key from it
        const rootKeyTest = await key.store.import(new Uint8Array(randomBytes(64)), 'xhd-root-key', 'seed')
        // When the format is raw, the key should be the raw Root Key. When the format is seed, it should be the seed to be imported and also create the root key and xhd-derived key
        const otherEd255Key = await key.store.import(new Uint8Array(randomBytes(64)), 'xhd-derived-ed25519', 'seed')


        // HD Accounts
        // const seeds = key.store.list().filter(k => k.type === 'hd-seed')
        // const rootKeyId = await key.store.generate({
        //     type: 'hd-root-key',
        //     algorithm: 'raw',
        //     extractable: true,
        //     keyUsages: ['deriveKey', 'deriveBits'],
        //     params: {
        //         parentKeyId: seeds[0].id
        //     }
        // })
        // setActiveKey(keyId);
        // setActiveRootKey(rootKeyId);
        // setActiveSeed(seeds[0].id);
    }

    const handleExportKey = async (id: string) => {
        try {
            const keyData = await key.store.export(id);
            Alert.alert(
                "Key Material",
                JSON.stringify(keyData, (_key, value) => {
                    if (value instanceof Uint8Array) {
                        return Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
                    }
                    return value;
                }, 2),
                [{ text: "OK" }]
            );
        } catch (error: any) {
            Alert.alert("Export Failed", error.message);
        }
    }

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.header}>
                <View>
                    <Text style={styles.welcomeText}>Keystore Status</Text>
                    <View style={styles.statusBadge}>
                        <View style={[styles.statusDot, { backgroundColor: status === 'idle' ? '#4CAF50' : status === 'generating' ? '#FF9800' : '#999' }]} />
                        <Text style={styles.statusText}>{status}</Text>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Link href="/accounts" asChild>
                        <TouchableOpacity style={styles.navButton}>
                            <MaterialCommunityIcons name="account-group" size={24} color="#007AFF" />
                            <Text style={styles.navButtonText}>Accounts</Text>
                        </TouchableOpacity>
                    </Link>
                    {status === 'computing' && <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 10 }} />}
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.balanceCard}>
                    <Text style={styles.balanceLabel}>Secure Keystore</Text>
                    <Text style={styles.balanceAmount}>{keys.length} Keys</Text>
                    <View style={styles.actionButtons}>
                        <TouchableOpacity
                            style={[styles.actionButton, status === 'computing' && {opacity: 0.5}]}
                            onPress={handleAddKey}
                            disabled={status !== 'idle'}
                        >
                            <View style={[styles.iconCircle, {backgroundColor: '#E3F2FD'}]}>
                                <MaterialCommunityIcons name="plus-circle-outline" size={24} color="#007AFF" />
                            </View>
                            <Text style={styles.actionText}>Generate</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton} onPress={handleImportSeed} disabled={status !== 'idle'}>
                            <View style={[styles.iconCircle, {backgroundColor: '#E8F5E9'}]}>
                                <MaterialCommunityIcons name="import" size={24} color="#4CAF50" />
                            </View>
                            <Text style={styles.actionText}>Import</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton} onPress={() => key.store.clear()} disabled={status !== 'idle'}>
                            <View style={[styles.iconCircle, {backgroundColor: '#FFF3E0'}]}>
                                <MaterialCommunityIcons name="delete-sweep-outline" size={24} color="#FF9800" />
                            </View>
                            <Text style={styles.actionText}>Clear All</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Derived Keys</Text>
                {derivedKeys.length === 0 ? (
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={styles.emptyState}
                    >
                        <Text style={styles.emptyStateText}>No derived keys yet.</Text>
                    </Animated.View>
                ) : (
                    derivedKeys.map((item, i) => {
                        const parentColor = rootKeyColors[item.metadata?.parentKeyId as string] || '#666';
                        return (
                            <Animated.View
                                key={item.id || i}
                                entering={FadeIn.duration(300)}
                                exiting={FadeOut.duration(300)}
                                layout={LinearTransition.springify()}
                            >
                                <TouchableOpacity
                                    style={[
                                        styles.keyCard, 
                                        activeKey === item.id && styles.activeKeyCard,
                                        activeKey === item.id && { borderColor: parentColor }
                                    ]}
                                    onPress={() => setActiveKey(item.id)}
                                >
                                    <View style={styles.keyInfo}>
                                        <View style={[
                                            styles.keyIconContainer, 
                                            { backgroundColor: `${parentColor}15` }
                                        ]}>
                                            <MaterialCommunityIcons
                                                name="key"
                                                size={20}
                                                color={activeKey === item.id ? parentColor : `${parentColor}80`}
                                            />
                                        </View>
                                        <View>
                                            <Text style={[
                                                styles.keyType, 
                                                activeKey === item.id && styles.activeKeyType,
                                                activeKey === item.id && { color: parentColor }
                                            ]}>
                                                {item.type}
                                                {item.type === 'hd-derived-ed25519' && item.metadata && (
                                                    <Text style={styles.keyIndex}> (a:{item.metadata.account as number} i:{item.metadata.index as number})</Text>
                                                )}
                                                {(item as any).privateKey && (
                                                    <MaterialCommunityIcons name="alert-circle" size={16} color="#FF3B30" style={styles.warningIcon} />
                                                )}
                                            </Text>
                                            <Text style={styles.keyAddress}>{item.algorithm}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.keyActions}>
                                        <TouchableOpacity onPress={() => handleExportKey(item.id)} style={styles.actionIcon}>
                                            <MaterialCommunityIcons name="export-variant" size={24} color="#007AFF" />
                                            {item.extractable && (
                                                <View style={styles.exportBadgeSmall} />
                                            )}
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => key.store.remove(item.id)}>
                                            <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
                                </TouchableOpacity>
                            </Animated.View>
                        );
                    })
                )}

                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Root Keys</Text>
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
                                entering={FadeIn.duration(300)}
                                exiting={FadeOut.duration(300)}
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
                                                {(item as any).privateKey && (
                                                    <MaterialCommunityIcons name="alert-circle" size={16} color="#FF3B30" style={styles.warningIcon} />
                                                )}
                                            </Text>
                                            <Text style={styles.keyAddress}>{item.algorithm}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.keyActions}>
                                        <TouchableOpacity onPress={() => handleExportKey(item.id)} style={styles.actionIcon}>
                                            <MaterialCommunityIcons name="export-variant" size={24} color="#007AFF" />
                                            {item.extractable && (
                                                <View style={styles.exportBadgeSmall} />
                                            )}
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => key.store.remove(item.id)}>
                                            <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
                                </TouchableOpacity>
                            </Animated.View>
                        );
                    })
                )}

                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Seeds</Text>
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
                                entering={FadeIn.duration(300)}
                                exiting={FadeOut.duration(300)}
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
                                                {(item as any).privateKey && (
                                                    <MaterialCommunityIcons name="alert-circle" size={16} color="#FF3B30" style={styles.warningIcon} />
                                                )}
                                            </Text>
                                            <Text style={styles.keyAddress}>{item.algorithm}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.keyActions}>
                                        <TouchableOpacity onPress={() => handleExportKey(item.id)} style={styles.actionIcon}>
                                            <MaterialCommunityIcons name="export-variant" size={24} color="#007AFF" />
                                            {item.extractable && (
                                                <View style={styles.exportBadgeSmall} />
                                            )}
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => key.store.remove(item.id)}>
                                            <MaterialCommunityIcons name="delete-outline" size={24} color="#FF3B30" />
                                        </TouchableOpacity>
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
    walletName: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1A1A1A',
    },
    profileButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
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
    keyCard: {
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
        borderWidth: 2,
        borderColor: 'transparent',
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
        backgroundColor: '#F0F0F0',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    activeKeyIconContainer: {
        backgroundColor: '#E3F2FD',
    },
    keyType: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#666',
        marginBottom: 2,
    },
    activeKeyType: {
        color: '#007AFF',
    },
    keyIndex: {
        fontSize: 10,
        color: '#666',
        fontWeight: 'normal',
    },
    exportBadgeSmall: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#4CAF50',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    warningIcon: {
        marginLeft: 8,
    },
    keyAddress: {
        fontSize: 15,
        color: '#333',
        fontWeight: '500',
    },
    keyActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionIcon: {
        marginRight: 12,
    },
    keyId: {
        fontSize: 14,
        color: '#999',
    },
    emptyState: {
        padding: 20,
        alignItems: 'center',
        backgroundColor: '#F0F0F0',
        borderRadius: 12,
        marginBottom: 16,
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: '#CCC',
    },
    emptyStateText: {
        color: '#999',
    },
    inputContainer: {
        flexDirection: "row",
        marginBottom: 16,
    },
    input: {
        flex: 1,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: "#E0E0E0",
        padding: 12,
        marginRight: 10,
        borderRadius: 12,
        fontSize: 16,
    },
    addButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 20,
        justifyContent: 'center',
        borderRadius: 12,
    },
    addButtonText: {
        color: '#FFF',
        fontWeight: 'bold',
    },
    secretItem: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 12,
        backgroundColor: '#FFF',
        borderRadius: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#F0F0F0',
    },
    secretName: {
        fontSize: 16,
        fontWeight: "600",
        color: '#333',
    },
    secretId: {
        fontSize: 11,
        color: "#999",
    },
});