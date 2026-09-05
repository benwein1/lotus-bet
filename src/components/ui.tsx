import * as Haptics from 'expo-haptics';
import { cssInterop } from 'nativewind';
import { forwardRef, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from '@/components/animated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatAgorot, initials } from '@/lib/format';
import { useColors, useScheme } from '@/providers/theme-provider';
import { avatarColors, elevation, motion, tabular } from '@/theme';

/**
 * The shared vocabulary. Everything here is presentational; anything with
 * product logic lives in its own file (bet-card.tsx, odds-bar.tsx, media.tsx).
 *
 * Three rules hold throughout:
 * - Colour comes from the semantic classes, never a literal hex, so every
 *   component is correct in both schemes without a `dark:` variant anywhere.
 * - Feedback happens on press-*in*, not on release. A control that only reacts
 *   once you let go feels dead.
 * - Motion is spring-driven and interruptible. Nothing in the app plays an
 *   animation the user has to wait out.
 */

// --- Press feedback ---------------------------------------------------------

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Same trap as `Animated.View`: NativeWind does not know this component, so
// its `className` would be dropped silently. See src/components/animated.ts.
cssInterop(AnimatedPressable, { className: 'style' });

export function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(style);
}

export function selectionTap() {
  if (Platform.OS === 'web') return;
  void Haptics.selectionAsync();
}

interface PressableScaleProps extends PressableProps {
  /** How far to scale down. Small targets want less travel than big ones. */
  scaleTo?: number;
  /** Dim as well as shrink — right for rows and plain text buttons. */
  dim?: boolean;
  haptic?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A Pressable that responds the instant a finger lands on it. This is the
 * single biggest difference between an app that feels built and one that
 * feels rendered.
 */
export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  { scaleTo = 0.97, dim = false, haptic = false, style, onPressIn, onPressOut, disabled, ...props },
  ref
) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduced = useReducedMotion();

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <AnimatedPressable
      ref={ref as never}
      disabled={disabled}
      style={[animated, style as never]}
      onPressIn={(e) => {
        // Feedback is never removed under reduced motion — an unresponsive
        // press reads as a broken app. Only the travel goes; the dim stays.
        scale.value = reduced ? 1 : withSpring(scaleTo, motion.press);
        if (dim || reduced) opacity.value = withTiming(0.6, { duration: 90 });
        if (haptic) tap();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = reduced ? 1 : withSpring(1, motion.press);
        opacity.value = withTiming(1, { duration: 160 });
        onPressOut?.(e);
      }}
      {...props}
    />
  );
});

// --- Surfaces ---------------------------------------------------------------

type SurfaceLevel = 'flat' | 'sunken' | 'base' | 'raised';

const SURFACE: Record<SurfaceLevel, string> = {
  flat: '',
  sunken: 'bg-sunken',
  base: 'bg-surface',
  raised: 'bg-surface2',
};

export function Card({
  className = '',
  level = 'base',
  padded = true,
  bordered = true,
  shadow = false,
  style,
  ...props
}: ViewProps & {
  className?: string;
  level?: SurfaceLevel;
  padded?: boolean;
  bordered?: boolean;
  /** Off by default. Weight is earned, not applied to every surface. */
  shadow?: boolean;
}) {
  return (
    <View
      style={[shadow ? elevation.card : null, style]}
      className={`rounded-3xl ${SURFACE[level]} ${bordered ? 'border border-hairline' : ''} ${
        padded ? 'p-4' : ''
      } ${className}`}
      {...props}
    />
  );
}

/**
 * The iOS inset grouped list: one rounded surface, rows divided by hairlines
 * that stop short of the left edge. It is the most familiar container on the
 * platform, and it needs no chrome of its own to read as a group.
 */
export function ListGroup({
  header,
  footer,
  children,
  className = '',
}: {
  header?: string;
  footer?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={className}>
      {header && (
        <Text className="mb-2 px-4 text-sm uppercase tracking-[0.5px] text-secondary">
          {header}
        </Text>
      )}
      <View className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {children}
      </View>
      {footer && <Text className="mt-2 px-4 text-sm leading-[18px] text-secondary">{footer}</Text>}
    </View>
  );
}

/** One row of a `ListGroup`. Divider is inset, the way iOS draws it. */
export function Row({
  label,
  value,
  leading,
  trailing,
  onPress,
  last = false,
  destructive = false,
}: {
  label: string;
  value?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  destructive?: boolean;
}) {
  const body = (
    <View className="flex-row items-center gap-3 px-4 py-3">
      {leading}
      <View className={`flex-1 flex-row items-center justify-between gap-3 ${last ? '' : ''}`}>
        <Text className={`text-base ${destructive ? 'text-negative' : 'text-primary'}`}>
          {label}
        </Text>
        {typeof value === 'string' ? (
          <Text numberOfLines={1} className="max-w-[55%] text-base text-secondary">
            {value}
          </Text>
        ) : (
          value
        )}
      </View>
      {trailing}
    </View>
  );

  return (
    <View>
      {onPress ? (
        <PressableScale scaleTo={0.99} dim onPress={onPress} accessibilityRole="button">
          {body}
        </PressableScale>
      ) : (
        body
      )}
      {!last && <View className="ml-4 h-px bg-hairline" />}
    </View>
  );
}

/** A hairline. Never rounded, never coloured. */
export function Divider({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-hairline ${className}`} />;
}

// --- Typography -------------------------------------------------------------

/** Large Title. One per screen, at the top of the scroll. */
export function Title({ className = '', ...props }: TextProps & { className?: string }) {
  return <Text className={`text-3xl font-bold text-primary ${className}`} {...props} />;
}

/** The label above a group. Sentence case — never a tracked all-caps eyebrow. */
export function SectionTitle({
  className = '',
  action,
  children,
  ...props
}: TextProps & { className?: string; action?: React.ReactNode }) {
  return (
    <View className={`mb-3 flex-row items-end justify-between gap-3 ${className}`}>
      <Text className="text-lg font-semibold text-primary" {...props}>
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Overline({ className = '', ...props }: TextProps & { className?: string }) {
  return <Text className={`text-sm text-secondary ${className}`} {...props} />;
}

/**
 * A figure. Always tabular so digits do not shift as a value changes, and
 * coloured by direction unless told otherwise.
 */
export function Money({
  agorot,
  size = 'md',
  tone,
  sign = false,
  className = '',
}: {
  agorot: number;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  /** Omit to colour by direction. */
  tone?: 'neutral' | 'positive' | 'negative' | 'accent' | 'onMedia';
  sign?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: 'text-callout',
    md: 'text-xl',
    lg: 'text-2xl',
    xl: 'text-4xl',
    hero: 'text-5xl',
  } as const;

  const resolved = tone ?? (agorot > 0 ? 'positive' : agorot < 0 ? 'negative' : 'neutral');
  const tones = {
    neutral: 'text-primary',
    positive: 'text-positive',
    negative: 'text-negative',
    accent: 'text-accent',
    onMedia: 'text-on-media',
  } as const;

  return (
    <Text
      style={tabular}
      numberOfLines={1}
      adjustsFontSizeToFit
      className={`font-bold ${sizes[size]} ${tones[resolved]} ${className}`}
    >
      {formatAgorot(agorot, { sign })}
    </Text>
  );
}

// --- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'plain' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

// The accent is the app's only decisive colour, so the primary action is a
// solid fill of it. Everything else steps down: a neutral fill, a tint of the
// accent, then type alone.
const BUTTON_VARIANT: Record<ButtonVariant, { container: string; label: string }> = {
  primary: { container: 'bg-accent', label: 'text-accent-ink' },
  secondary: { container: 'bg-surface2 border border-hairline', label: 'text-primary' },
  tinted: { container: 'bg-accent-soft', label: 'text-accent' },
  plain: { container: 'bg-transparent', label: 'text-accent' },
  destructive: { container: 'bg-negative-soft', label: 'text-negative' },
};

const BUTTON_SIZE: Record<ButtonSize, { container: string; label: string }> = {
  sm: { container: 'h-9 rounded-xl px-3.5', label: 'text-subhead' },
  md: { container: 'h-12 rounded-2xl px-5', label: 'text-base' },
  lg: { container: 'h-[52px] rounded-2xl px-6', label: 'text-base' },
};

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    title,
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    disabled,
    className = '',
    onPress,
    ...props
  },
  ref
) {
  const colors = useColors();
  const v = BUTTON_VARIANT[variant];
  const s = BUTTON_SIZE[size];
  const isDisabled = disabled || loading;

  return (
    <PressableScale
      ref={ref}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
      disabled={isDisabled}
      onPress={(e) => {
        tap();
        onPress?.(e);
      }}
      className={`flex-row items-center justify-center gap-2 ${s.container} ${v.container} ${
        isDisabled ? 'opacity-40' : ''
      } ${className}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.accentInk : colors.accent}
          size="small"
        />
      ) : (
        <>
          {icon}
          <Text className={`font-semibold ${s.label} ${v.label}`}>{title}</Text>
        </>
      )}
    </PressableScale>
  );
});

/** A pill for filters, presets and quick picks. */
export function Chip({
  label,
  selected = false,
  onPress,
  className = '',
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  className?: string;
}) {
  return (
    <PressableScale
      scaleTo={0.94}
      onPress={() => {
        selectionTap();
        onPress?.();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`rounded-full border px-3.5 py-2 ${
        selected ? 'border-accent bg-accent-soft' : 'border-hairline bg-surface2'
      } ${className}`}
    >
      <Text
        className={`text-subhead ${selected ? 'font-semibold text-accent' : 'text-secondary'}`}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * The iOS segmented control: a track with a thumb that springs between
 * positions rather than cutting. Two or three options, never more.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = useSharedValue(0);
  const offset = useSharedValue(0);

  // The thumb travels on `translateX`, never on `left` — a position animation
  // re-lays-out the whole track on every frame.
  useEffect(() => {
    const target = segment.value * index;
    offset.value = reduced ? target : withSpring(target, motion.press);
  }, [index, offset, reduced, segment]);

  const thumb = useAnimatedStyle(() => ({
    width: segment.value,
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      className={`h-9 flex-row overflow-hidden rounded-lg bg-surface3 p-0.5 ${className}`}
      accessibilityRole="radiogroup"
      onLayout={(e) => {
        const width = (e.nativeEvent.layout.width - 4) / options.length;
        segment.value = width;
        offset.value = width * index;
      }}
    >
      <Animated.View
        style={thumb}
        className="absolute bottom-0.5 left-0.5 top-0.5 rounded-[7px] bg-surface"
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              selectionTap();
              onChange(option.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            className="flex-1 items-center justify-center"
          >
            <Text
              className={`text-sm ${active ? 'font-semibold text-primary' : 'text-secondary'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Badges -----------------------------------------------------------------

type BadgeTone = 'neutral' | 'open' | 'locked' | 'resolved' | 'cancelled' | 'win' | 'loss';

const BADGE_TONE: Record<BadgeTone, { wrap: string; text: string; dot: string }> = {
  neutral: { wrap: 'bg-surface3', text: 'text-secondary', dot: 'bg-tertiary' },
  open: { wrap: 'bg-accent-soft', text: 'text-accent', dot: 'bg-accent' },
  locked: { wrap: 'bg-surface3', text: 'text-primary', dot: 'bg-tertiary' },
  resolved: { wrap: 'bg-surface3', text: 'text-secondary', dot: 'bg-tertiary' },
  cancelled: { wrap: 'bg-surface3', text: 'text-tertiary', dot: 'bg-tertiary' },
  win: { wrap: 'bg-positive-soft', text: 'text-positive', dot: 'bg-positive' },
  loss: { wrap: 'bg-negative-soft', text: 'text-negative', dot: 'bg-negative' },
};

export function Badge({
  label,
  tone = 'neutral',
  dot = true,
}: {
  label: string;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  const t = BADGE_TONE[tone];
  return (
    <View className={`flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1 ${t.wrap}`}>
      {dot && <View className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      <Text className={`text-xs font-semibold capitalize ${t.text}`}>{label}</Text>
    </View>
  );
}

/** A pulsing dot, for "this is live right now". */
export function LiveDot({ className = '' }: { className?: string }) {
  const colors = useColors();
  const pulse = useSharedValue(1);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [pulse, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[style, { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent }]}
      className={className}
    />
  );
}

// --- Identity ---------------------------------------------------------------

export function Avatar({
  name,
  id,
  size = 36,
  ring = false,
}: {
  name: string;
  /** Stable seed for the colour. Falls back to the name. */
  id?: string;
  size?: number;
  ring?: boolean;
}) {
  const scheme = useScheme();
  const colors = useColors();
  const { bg, fg } = avatarColors(id ?? name, scheme);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: ring ? 2 : 0,
        borderColor: ring ? colors.canvas : 'transparent',
      }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.36, color: fg }} className="font-semibold">
        {initials(name)}
      </Text>
    </View>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = 26,
}: {
  people: { id?: string; name: string }[];
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;

  return (
    <View className="flex-row items-center">
      {shown.map((person, index) => (
        <View
          key={`${person.id ?? person.name}-${index}`}
          style={{ marginLeft: index === 0 ? 0 : -size * 0.3, zIndex: max - index }}
        >
          <Avatar name={person.name} id={person.id} size={size} ring />
        </View>
      ))}
      {extra > 0 && (
        <View
          style={{ width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.3 }}
          className="items-center justify-center bg-surface3"
        >
          <Text className="text-2xs font-semibold text-secondary">+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// --- States -----------------------------------------------------------------

/** Shimmering placeholder. Compose these into screen-shaped skeletons. */
export function Skeleton({
  width,
  height = 14,
  radius = 8,
  className = '',
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  className?: string;
}) {
  const shimmer = useSharedValue(0.5);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 780, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.5, { duration: 780, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [shimmer, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View
      style={[style, { width: width ?? '100%', height, borderRadius: radius }]}
      className={`bg-surface3 ${className}`}
    />
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="items-center px-6 py-12">
      <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-surface2">
        {icon}
      </View>
      <Text className="mb-1.5 text-lg font-semibold text-primary">{title}</Text>
      <Text className="max-w-[300px] text-center text-subhead leading-5 text-secondary">{body}</Text>
      {action && <View className="mt-6">{action}</View>}
    </View>
  );
}

export function ErrorNotice({ message, className = '' }: { message: string; className?: string }) {
  return (
    <View className={`mb-4 flex-row gap-3 rounded-2xl bg-negative-soft px-4 py-3 ${className}`}>
      <Text className="flex-1 text-subhead leading-5 text-negative">{message}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <ActivityIndicator color={colors.textTertiary} />
      {label && <Text className="text-subhead text-secondary">{label}</Text>}
    </View>
  );
}

// --- Data display -----------------------------------------------------------

/** A labelled figure. Three across is the standard row. */
export function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-negative'
        : tone === 'accent'
          ? 'text-accent'
          : 'text-primary';

  return (
    <View className="flex-1 rounded-2xl border border-hairline bg-surface px-3.5 py-3">
      <Text
        style={tabular}
        numberOfLines={1}
        adjustsFontSizeToFit
        className={`text-xl font-bold ${toneClass}`}
      >
        {value}
      </Text>
      <Text numberOfLines={1} className="mt-0.5 text-xs text-secondary">
        {label}
      </Text>
    </View>
  );
}

/** Label/value row inside a card. */
export function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between gap-4 py-3 ${
        last ? '' : 'border-b border-hairline'
      }`}
    >
      <Text className="text-subhead text-secondary">{label}</Text>
      {typeof value === 'string' ? (
        <Text numberOfLines={1} className="flex-1 text-right text-subhead text-primary">
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

// --- Forms ------------------------------------------------------------------

/**
 * A grouped form block: one rounded surface, fields divided by inset
 * hairlines. Labels sit inside the field rather than floating above it, which
 * is how every native form on the platform is laid out.
 */
export function FieldGroup({
  children,
  footer,
  className = '',
}: {
  children: React.ReactNode;
  footer?: string;
  className?: string;
}) {
  return (
    <View className={className}>
      <View className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        {children}
      </View>
      {footer && <Text className="mt-2 px-4 text-sm leading-[18px] text-secondary">{footer}</Text>}
    </View>
  );
}

interface TextFieldProps extends Omit<TextInputProps, 'className' | 'style'> {
  label: string;
  last?: boolean;
  /** Trailing control — a show/hide toggle, a unit, a clear button. */
  accessory?: React.ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, last = false, accessory, onFocus, onBlur, ...props },
  ref
) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <View className="flex-row items-center gap-3 px-4">
        <Text className={`w-[86px] py-3 text-base ${focused ? 'text-accent' : 'text-secondary'}`}>
          {label}
        </Text>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className="h-12 flex-1 text-base text-primary"
          {...props}
        />
        {accessory}
      </View>
      {!last && <View className="ml-4 h-px bg-hairline" />}
    </View>
  );
});

/**
 * A full-width field with the label above it, for anything long enough that a
 * leading label would squeeze it: a bet title, a description.
 */
export const BlockField = forwardRef<
  TextInput,
  Omit<TextFieldProps, 'label' | 'last' | 'accessory'> & { label?: string }
>(function BlockField({ label, onFocus, onBlur, multiline, ...props }, ref) {
    const colors = useColors();
    const [focused, setFocused] = useState(false);

    return (
      <View>
        {label ? <Text className="mb-2 px-1 text-sm text-secondary">{label}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={multiline ? { textAlignVertical: 'top' } : undefined}
          className={`rounded-2xl border bg-surface px-4 text-base text-primary ${
            multiline ? 'min-h-[96px] py-3' : 'h-12 py-0'
          } ${focused ? 'border-accent' : 'border-hairline'}`}
          {...props}
        />
      </View>
    );
});
