import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import { forwardRef, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import { formatMoney } from '@/lib/currency';
import { initials } from '@/lib/format';
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

  // Whether this pressable dims under the finger at all. Only `dim`, and the
  // reduced-motion path that substitutes a dim for the travel, ever move it.
  const dims = dim || reduced;

  /**
   * The opacity key is omitted entirely when nothing is going to animate it.
   *
   * NativeWind merges `className` into `style`, and this animated style sits in
   * the same array — so returning `opacity: 1` here *overrode* every
   * `opacity-*` class on every PressableScale in the app. Disabled buttons and
   * busy option squares were fully inert (`pointer-events: none`,
   * `aria-disabled`) while rendering at full strength, which is the exact
   * "control that looks live but is not" this codebase argues against
   * everywhere else. Measured at `opacity: 1` on a disabled primary button.
   */
  const animated = useAnimatedStyle(() =>
    dims
      ? { transform: [{ scale: scale.value }], opacity: opacity.value }
      : { transform: [{ scale: scale.value }] }
  );

  return (
    <AnimatedPressable
      ref={ref as never}
      disabled={disabled}
      style={[animated, style as never]}
      onPressIn={(e) => {
        // Feedback is never removed under reduced motion — an unresponsive
        // press reads as a broken app. Only the travel goes; the dim stays.
        scale.value = reduced ? 1 : withSpring(scaleTo, motion.press);
        if (dims) opacity.value = withTiming(0.6, { duration: 90 });
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
 *
 * `agorot` kept its name along with the columns it reads: the integer is minor
 * units of whichever currency the group keeps its books in, and the maths
 * never cared which. Pass `currency` wherever a group is in scope; omitting it
 * prints the default rather than throwing, because a row fetched before
 * `…_group_currency.sql` has no column to read.
 */
export function Money({
  agorot,
  currency,
  size = 'md',
  tone,
  sign = false,
  className = '',
}: {
  agorot: number;
  currency?: string | null;
  /**
   * `pot`, `betPot` and `net` are the three sizes the design boards drew that
   * the Apple scale has no step for — 22, 20 and 40. They are spelled out
   * rather than rounded to the nearest step because the feed card, the bet
   * hero and the profile balance are the three places a figure is the largest
   * thing in its block, and a 2px difference shows there.
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero' | 'pot' | 'betPot' | 'net';
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
    pot: 'text-[22px] leading-[26px] tracking-[-0.26px]',
    betPot: 'text-[20px] leading-[24px] tracking-[-0.3px]',
    net: 'text-[40px] leading-[40px] tracking-[-1px]',
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
      {formatMoney(agorot, currency, { sign })}
    </Text>
  );
}

// --- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'plain' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

// The accent is the app's only decisive colour, so the primary action is a
// solid fill of it. Everything else steps down: a bordered neutral fill, a
// tint of the accent, then type alone.
//
// Every variant that is meant to look like a *surface* carries a border. A
// fill alone is not enough: `surface2` over `sunken` is #F5F5F8 on #F2F2F7 in
// light and #17171C on black in dark, so a secondary button with no rule
// around it reads as a piece of text floating on the page rather than
// something you can press.
const BUTTON_VARIANT: Record<ButtonVariant, { container: string; label: string }> = {
  primary: { container: 'bg-accent', label: 'text-accent-ink' },
  secondary: { container: 'bg-surface border border-hairline-strong', label: 'text-primary' },
  tinted: { container: 'bg-accent-soft border border-accent-soft', label: 'text-accent' },
  plain: { container: 'bg-transparent', label: 'text-accent' },
  destructive: { container: 'bg-negative-soft border border-negative', label: 'text-negative' },
};

// Minimum heights, not fixed ones. At the larger Dynamic Type sizes a label
// is taller than the button was, and a fixed height clips it — the control
// has to be allowed to grow around its text.
const BUTTON_SIZE: Record<ButtonSize, { container: string; label: string }> = {
  sm: { container: 'min-h-9 rounded-xl px-3.5 py-1.5', label: 'text-subhead' },
  md: { container: 'min-h-12 rounded-2xl px-5 py-2.5', label: 'text-base' },
  lg: { container: 'min-h-[52px] rounded-2xl px-6 py-3', label: 'text-base' },
};

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  /**
   * Lift the button off the page. Reserved for the one action a screen exists
   * to get you to — creating a group, posting a bet — so that weight still
   * means something when you see it.
   */
  elevated?: boolean;
  className?: string;
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    title,
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    elevated = false,
    disabled,
    className = '',
    onPress,
    style,
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
      style={[elevated && !isDisabled ? elevation.card : null, style as never]}
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
  multi = false,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  className?: string;
  /**
   * True when this chip is one of several that can be on at once.
   *
   * It only changes what a screen reader is told, and that is the point: the
   * default `radio` announces the group as mutually exclusive, so a row of
   * invitees read as "pick one of these" when any number can be picked.
   */
  multi?: boolean;
}) {
  return (
    <PressableScale
      scaleTo={0.94}
      onPress={() => {
        selectionTap();
        onPress?.();
      }}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      className={`rounded-full border px-3.5 py-2 ${
        selected ? 'border-brand bg-brand-soft' : 'border-hairline bg-surface2'
      } ${className}`}
    >
      <Text
        className={`text-subhead ${
          selected ? 'font-semibold text-brand-strong' : 'text-secondary'
        }`}
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
  // Brand green rather than accent blue. "Open" is a state the bet is in, not
  // something to press — and it is the same state `LiveDot` reports two
  // components down, so the two have to agree. See the `brand` note in
  // tailwind.config.js for why this is never used for an amount or a side.
  open: { wrap: 'bg-brand-soft', text: 'text-brand-strong', dot: 'bg-brand' },
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

/**
 * A pulsing dot, for "this is live right now".
 *
 * Brand green, not accent blue: blue is what you press, and this is not a
 * control — it is the bet telling you it is still running. Green for "live" is
 * the one colour convention people already arrive with. It sits eight degrees
 * of hue from `positive`, so it is deliberately never used for an amount.
 */
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
      style={[style, { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand }]}
      className={className}
    />
  );
}

// --- Identity ---------------------------------------------------------------

export function Avatar({
  name,
  id,
  uri,
  size = 36,
  ring = false,
}: {
  name: string;
  /** Stable seed for the colour. Falls back to the name. */
  id?: string;
  /** A profile picture. Without one the initials stand in. */
  uri?: string | null;
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
        // The tinted ground stays under the photo: it is what shows while the
        // image loads, so an avatar never flashes as a hole in the layout.
        backgroundColor: bg,
        borderWidth: ring ? 2 : 0,
        borderColor: ring ? colors.canvas : 'transparent',
        overflow: 'hidden',
      }}
      className="items-center justify-center"
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={160}
          // The same face appears many times over — every option roster, every
          // balance row, every comment — and it is recycled through list cells
          // like any other image. `recyclingKey` stops a reused avatar showing
          // the last person's face for a frame; the memory cache means the
          // second appearance of a face costs no decode at all.
          recyclingKey={uri}
          cachePolicy="memory-disk"
          accessibilityLabel={name}
        />
      ) : (
        <Text style={{ fontSize: size * 0.36, color: fg }} className="font-semibold">
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = 26,
}: {
  people: { id?: string; name: string; avatarUrl?: string | null }[];
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
          <Avatar name={person.name} id={person.id} uri={person.avatarUrl} size={size} ring />
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

// --- Confirmation -----------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** The button that goes through with it. */
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * The app's own confirmation, not the platform's.
 *
 * `Alert.alert` is a no-op on react-native-web — it is literally an empty
 * static method — so every irreversible action in the app (resolving a bet,
 * cancelling one, marking a payment settled, signing out) silently did nothing
 * in a browser. A dialog rendered in-app works on all three platforms and
 * looks like the rest of the product rather than the OS.
 */
export function useConfirm(): { ask: (options: ConfirmOptions) => void; dialog: React.ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const ask = useCallback((next: ConfirmOptions) => setOptions(next), []);
  const close = useCallback(() => setOptions(null), []);

  return {
    ask,
    dialog: <ConfirmDialog options={options} onClose={close} />,
  };
}

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={options !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* The scrim is inert: dismissing goes through the Cancel button, and on
          Android through `onRequestClose`. Tap-to-dismiss would mean either an
          absolutely positioned overlay — which on the web paints above its
          unpositioned siblings and swallows presses meant for the card — or
          wrapping the card in the Pressable, which makes every button inside
          it part of that one button. Neither is worth it for a shortcut past a
          button that is already on screen. */}
      <View className="flex-1 items-center justify-center bg-scrim px-8">
        {options && (
          <View
            style={elevation.sheet}
            className="w-full max-w-[340px] overflow-hidden rounded-3xl border border-hairline-strong bg-surface p-6"
          >
            <Text className="text-lg font-bold text-primary">{options.title}</Text>
            {options.message && (
              <Text className="mt-2 text-subhead leading-5 text-secondary">{options.message}</Text>
            )}

            <View className="mt-6 gap-3">
              <Button
                title={options.confirmLabel}
                variant={options.destructive ? 'destructive' : 'primary'}
                size="lg"
                onPress={() => {
                  const run = options.onConfirm;
                  onClose();
                  run();
                }}
              />
              <Button
                title={options.cancelLabel ?? 'Cancel'}
                variant="plain"
                size="lg"
                onPress={onClose}
              />
            </View>
          </View>
        )}
      </View>
    </Modal>
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
          // `flex-1` sets a zero basis but leaves `min-width: auto`, so on the
          // web the input keeps its intrinsic width and refuses to shrink —
          // which shoved the reveal-password eye past the right edge of the
          // field group on every auth screen. Same trap as PaymentSheet;
          // CLAUDE.md §4 gotcha 4b.
          style={{ minWidth: 0 }}
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
