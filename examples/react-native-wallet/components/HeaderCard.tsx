import { Text, View, TouchableOpacity, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import React from "react";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface HeaderAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}

export interface HeaderCardProps {
  /** Small uppercase tagline shown below the title. */
  label: string;
  /** Large main title: either a count or a name. */
  title: string | number;
  /** Icon shown in an inverted (white) circle next to the title. */
  icon: IconName;
  /** Accent color used as the card background. Defaults to a brand purple. */
  accentColor?: string;
  /** Optional description shown below the title (used by the dashboard). */
  description?: string;
  /** Optional action buttons shown grouped below the title (used by sub-pages). */
  actions?: HeaderAction[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Unified header card used at the top of every screen.
 *
 * The card is tinted with the screen's `accentColor` and pairs it with an
 * inverted icon (white circle, accent-colored glyph). Title is rendered
 * above the uppercase label, and actions appear as a single grouped,
 * segmented control beneath the title.
 */
export function HeaderCard({
  label,
  title,
  icon,
  accentColor = "#5856D6",
  description,
  actions = [],
  style,
}: HeaderCardProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      style={[styles.card, { backgroundColor: accentColor }, style]}
    >
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name={icon} size={28} color={accentColor} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>

      {description ? (
        <Text style={styles.description} numberOfLines={3}>
          {description}
        </Text>
      ) : null}

      {actions.length > 0 && (
        <View style={styles.actionGroup}>
          {actions.map((action, i) => (
            <React.Fragment key={action.label}>
              {i > 0 && <View style={styles.actionDivider} />}
              <TouchableOpacity
                style={[styles.actionSegment, action.disabled && styles.actionDisabled]}
                onPress={action.onPress}
                disabled={action.disabled}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name={action.icon} size={18} color="#FFF" />
                <Text style={styles.actionText}>{action.label}</Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
    justifyContent: "center",
    minHeight: 200,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFF",
  },
  label: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 4,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
  },
  description: {
    fontSize: 13,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 18,
    marginTop: 14,
  },
  actionGroup: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 20,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderRadius: 14,
    overflow: "hidden",
  },
  actionSegment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 6,
  },
  actionDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFF",
  },
});
