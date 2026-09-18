import { Text, View, StyleSheet, TouchableOpacity } from "react-native";
import { Link, type Href } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface AssociationRowAction {
  /** Icon shown in the trailing action button. */
  icon: IconName;
  /** Optional accessible label / hint. */
  label?: string;
  /** Destination route. If provided, the action acts as a Link. */
  href?: Href;
  /** Tap handler, used when `href` is not provided. */
  onPress?: () => void;
  /** Tint for the action icon. Defaults to the row accent color. */
  color?: string;
}

export interface AssociationRowProps {
  icon: IconName;
  /** Primary line (e.g. address or key id). Truncated in the middle. */
  title: string;
  /** Secondary line shown beneath the title. */
  subtitle?: string | null;
  /** Accent color used for the icon and left border. */
  accentColor?: string;
  /** Destination route for the row itself. Ignored when `onPress` or `action` is set. */
  href?: Href;
  /** Tap handler for the row body (e.g. selection). When provided, the row is not navigated. */
  onPress?: () => void;
  /** Visual selected state; adds a subtle highlight. */
  selected?: boolean;
  /**
   * Optional trailing action button. When provided, the row itself is no
   * longer auto-navigated via `href`: the dedicated button handles
   * navigation while the row body remains free for selection/onPress.
   */
  action?: AssociationRowAction;
}

/**
 * Compact, tappable row used inside `DetailSection`s to link to another
 * related record (key → account, account → identity, etc.). Visually
 * inherits the screen's `accentColor` so association lists stay tied
 * to the same seed/root color.
 *
 * When an `action` is provided, the row body becomes a selection/no-op
 * target and the trailing button handles navigation. This keeps "select"
 * and "go to details" as distinct gestures.
 */
export function AssociationRow({
  icon,
  title,
  subtitle,
  accentColor = "#5856D6",
  href,
  onPress,
  selected,
  action,
}: AssociationRowProps) {
  // The row is "interactive" if it has its own onPress, OR if it should
  // navigate via href AND there's no trailing action stealing navigation.
  const rowNavigable = !!href && !onPress && !action;

  const body = (
    <View
      style={[
        styles.row,
        { borderLeftColor: accentColor },
        selected && { backgroundColor: `${accentColor}1A` },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: `${accentColor}1F` }]}>
        <MaterialCommunityIcons name={icon} size={20} color={accentColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        action.href ? (
          <Link href={action.href} asChild>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={styles.actionButton}
              hitSlop={8}
            >
              <MaterialCommunityIcons
                name={action.icon}
                size={22}
                color={action.color ?? accentColor}
              />
            </TouchableOpacity>
          </Link>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={styles.actionButton}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name={action.icon}
              size={22}
              color={action.color ?? accentColor}
            />
          </TouchableOpacity>
        )
      ) : rowNavigable ? (
        <MaterialCommunityIcons name="chevron-right" size={22} color="#BBB" />
      ) : null}
    </View>
  );

  if (rowNavigable) {
    return (
      <Link href={href!} asChild>
        <TouchableOpacity activeOpacity={0.7}>{body}</TouchableOpacity>
      </Link>
    );
  }
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {body}
      </TouchableOpacity>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginVertical: 4,
    backgroundColor: "#FAFAFB",
    borderRadius: 10,
    borderLeftWidth: 3,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  subtitle: {
    fontSize: 11,
    color: "#888",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: "600",
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
});
