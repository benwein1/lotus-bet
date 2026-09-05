import { cssInterop } from 'nativewind';
import { forwardRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableProps,
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

import { initials } from '@/lib/format';
import { avatarColors, colors, elevation, motion } from '@/theme';

/**
 * The shared visual vocabulary. Everything here is presentational — anything
 * with product logic lives in its own file (bet-card.tsx, odds-bar.tsx).
 *
 * Two rules hold throughout:
 * - Colour comes from `className` tokens, never a literal hex. The exceptions
 *   are animated styles and SVG, which NativeWind cannot reach.
 * - Every tappable surface responds to touch. A press that does nothing
 *   visible reads as a broken app.
 */

// --- Press feedback ---------------------------------------------------------

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Same trap as `Animated.View`: NativeWind does not know this component, so
// its `className` would be dropped silently. See src/components/animated.ts.
cssInterop(AnimatedPressable, { className: 'style' });

interface PressableScaleProps extends PressableProps {
  /** How far to scale down on press. Smaller targets want less travel. */
  scaleTo?: number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A Pressable that springs down under the finger. This is the single biggest
 * difference between an app that feels built and one that feels rendered.
 */
export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  { scaleTo = 0.97, style, onPressIn, onPressOut, disabled, ...props },
  ref
) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      ref={ref as never}
      disabled={disabled}
      style={[animated, style as never]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, motion.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.press);
        onPressOut?.(e);
      }}
      {...props}
    />
  );
});

// --- Surfaces ---------------------------------------------------------------

type SurfaceLevel = 'sunken' | 'base' | 'raised';

const SURFACE: Record<SurfaceLevel, string> = {
  // Sunken reads as a well — used for inputs and inset rows.
  sunken: 'bg-ink-1000 border border-ink-800',
  base: 'bg-ink-900 border border-ink-800',
  // Raised is for the things that should feel closest to the user.
  raised: 'bg-ink-850 border border-ink-750',
};

export function Card({
  className = '',
  level = 'base',
  padded = true,
  shadow = true,
  style,
  ...props
}: ViewProps & {
  className?: string;
  level?: SurfaceLevel;
  padded?: boolean;
  shadow?: boolean;
}) {
  return (
    <View
      style={[shadow ? elevation.card : null, style]}
      className={`rounded-2xl ${SURFACE[level]} ${padded ? 'p-5' : ''} ${className}`}
      {...props}
    />
  );
}

/** A hairline that matches the card borders. */
export function Divider({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-ink-800 ${className}`} />;
}

// --- Typography -------------------------------------------------------------

/** Screen-level heading. One per screen, at the top of the scroll. */
export function Title({ className = '', ...props }: TextProps & { className?: string }) {
  return <Text className={`font-display-bold text-3xl text-ink-50 ${className}`} {...props} />;
}

/** The label above a group of cards. */
export function SectionTitle({
  className = '',
  action,
  children,
  ...props
}: TextProps & { className?: string; action?: React.ReactNode }) {
  return (
    <View className={`mb-3 flex-row items-center justify-between ${className}`}>
      <View className="flex-row items-center gap-2.5">
        <View className="h-px w-4 bg-ink-750" />
        <Text className="font-display text-xs text-ink-600" {...props}>
          {children}
        </Text>
      </View>
      {action}
    </View>
  );
}

/** Small caps label used inside cards, above a value. */
export function Overline({ className = '', ...props }: TextProps & { className?: string }) {
  return (
    <Text className={`font-display text-xs text-ink-600 ${className}`} {...props} />
  );
}

// --- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, { container: string; label: string }> = {
  primary: { container: 'bg-brass-500', label: 'text-white' },
  secondary: { container: 'bg-ink-800 border border-ink-700', label: 'text-ink-50' },
  ghost: { container: 'bg-transparent border border-ink-700', label: 'text-ink-500' },
  danger: { container: 'bg-owing-shade border border-owing/30', label: 'text-owing' },
  success: { container: 'bg-owed-shade border border-owed/30', label: 'text-owed' },
};

const BUTTON_SIZE: Record<ButtonSize, { container: string; label: string }> = {
  sm: { container: 'h-9 rounded-xl px-3.5', label: 'text-sm' },
  md: { container: 'h-12 rounded-2xl px-5', label: 'text-base' },
  lg: { container: 'h-14 rounded-2xl px-6', label: 'text-lg' },
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
    ...props
  },
  ref
) {
  const v = BUTTON_VARIANT[variant];
  const s = BUTTON_SIZE[size];
  const isDisabled = disabled || loading;

  return (
    <PressableScale
      ref={ref}
      scaleTo={0.965}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
      disabled={isDisabled}
      // The primary button carries a coloured glow so the main action on any
      // screen is findable without reading anything.
      style={variant === 'primary' && !isDisabled ? elevation.glow(colors.brass['600']) : undefined}
      className={`flex-row items-center justify-center gap-2 ${s.container} ${v.container} ${
        isDisabled ? 'opacity-40' : ''
      } ${className}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.ink['500']} size="small" />
      ) : (
        <>
          {icon}
          <Text className={`font-display ${s.label} ${v.label}`}>{title}</Text>
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
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`rounded-full border px-3.5 py-2 ${
        selected ? 'border-brass-500 bg-brass-900' : 'border-ink-700 bg-ink-850'
      } ${className}`}
    >
      <Text
        className={`font-display text-xs ${selected ? 'text-brass-300' : 'text-ink-600'}`}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

// --- Badges -----------------------------------------------------------------

type BadgeTone = 'neutral' | 'open' | 'locked' | 'resolved' | 'cancelled' | 'win' | 'loss';

const BADGE_TONE: Record<BadgeTone, { wrap: string; text: string; dot: string }> = {
  neutral: { wrap: 'bg-ink-800', text: 'text-ink-600', dot: 'bg-ink-600' },
  open: { wrap: 'bg-brass-900', text: 'text-brass-300', dot: 'bg-brass-400' },
  locked: { wrap: 'bg-warn-shade', text: 'text-warn', dot: 'bg-warn' },
  resolved: { wrap: 'bg-ink-800', text: 'text-ink-500', dot: 'bg-ink-600' },
  cancelled: { wrap: 'bg-ink-800', text: 'text-ink-600', dot: 'bg-ink-650' },
  win: { wrap: 'bg-owed-shade', text: 'text-owed', dot: 'bg-owed' },
  loss: { wrap: 'bg-owing-shade', text: 'text-owing', dot: 'bg-owing' },
};

export function Badge({
  label,
  tone = 'neutral',
  dot = true,
}: {
  label: string;
  tone?: BadgeTone;
  /** The status dot; turn it off for badges that are purely a label. */
  dot?: boolean;
}) {
  const t = BADGE_TONE[tone];
  return (
    <View className={`flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1 ${t.wrap}`}>
      {dot && <View className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      <Text className={`font-display text-2xs uppercase tracking-[0.8px] ${t.text}`}>{label}</Text>
    </View>
  );
}

/** A pulsing dot, for "this is live right now". */
export function LiveDot({ className = '' }: { className?: string }) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[style, { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.sideA.DEFAULT }]}
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
  const { bg, fg } = avatarColors(id ?? name);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2.6,
        backgroundColor: bg,
        borderWidth: ring ? 2 : 1,
        borderColor: ring ? fg : 'rgba(255,255,255,0.06)',
      }}
      className="items-center justify-center"
    >
      <Text
        style={{ fontSize: size * 0.34, color: fg }}
        className="font-display-bold"
      >
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
          style={{ marginLeft: index === 0 ? 0 : -size * 0.32, zIndex: max - index }}
        >
          <Avatar name={person.name} id={person.id} size={size} />
        </View>
      ))}
      {extra > 0 && (
        <View
          style={{ width: size, height: size, borderRadius: size / 2.6, marginLeft: -size * 0.32 }}
          className="items-center justify-center border border-ink-700 bg-ink-800"
        >
          <Text className="font-display text-2xs tracking-normal text-ink-600">+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// --- States -----------------------------------------------------------------

/** Shimmering placeholder block. Compose these into screen-shaped skeletons. */
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
  const shimmer = useSharedValue(0.35);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(0.75, { duration: 780, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 780, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [shimmer]);

  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View
      style={[
        style,
        {
          width: width ?? '100%',
          height,
          borderRadius: radius,
          backgroundColor: colors.ink['750'],
        },
      ]}
      className={className}
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
    <View className="items-center px-6 py-10">
      <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl border border-ink-750 bg-ink-850">
        {icon}
      </View>
      <Text className="mb-1.5 text-center font-display text-lg text-ink-50">{title}</Text>
      <Text className="max-w-[280px] text-center text-sm leading-5 text-ink-600">{body}</Text>
      {action && <View className="mt-5">{action}</View>}
    </View>
  );
}

/** Dashed container that wraps an EmptyState inside a section. */
export function EmptySlot({ children }: { children: React.ReactNode }) {
  return (
    <View className="rounded-2xl border border-dashed border-ink-750 bg-ink-900/40">{children}</View>
  );
}

export function ErrorNotice({ message, className = '' }: { message: string; className?: string }) {
  return (
    <View
      className={`mb-4 flex-row items-start gap-3 rounded-2xl border border-owing/25 bg-owing-shade px-4 py-3.5 ${className}`}
    >
      <View className="mt-0.5 h-4 w-4 items-center justify-center rounded-full bg-owing/20">
        <Text className="text-2xs font-bold tracking-normal text-owing">!</Text>
      </View>
      <Text className="flex-1 text-sm leading-5 text-owing">{message}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <ActivityIndicator color={colors.brass['400']} />
      <Text className="text-sm text-ink-600">{label}</Text>
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
  tone?: 'neutral' | 'owed' | 'owing' | 'accent';
}) {
  const toneClass =
    tone === 'owed'
      ? 'text-owed'
      : tone === 'owing'
        ? 'text-owing'
        : tone === 'accent'
          ? 'text-brass-300'
          : 'text-ink-50';

  return (
    <View className="flex-1 rounded-2xl border border-ink-800 bg-ink-900 px-3.5 py-4">
      <Overline>{label}</Overline>
      <Text numberOfLines={1} className={`mt-1.5 font-display-bold text-xl ${toneClass}`}>
        {value}
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
        last ? '' : 'border-b border-ink-800'
      }`}
    >
      <Text className="text-sm text-ink-600">{label}</Text>
      {typeof value === 'string' ? (
        <Text numberOfLines={1} className="flex-1 text-right font-display text-sm text-ink-50">
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}
