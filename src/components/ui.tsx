import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from 'react-native';

import { initials } from '@/lib/format';
import { colors } from '@/theme';

// Small, unopinionated building blocks. Anything with real product logic lives
// in its own file (see bet-card.tsx, odds-bar.tsx).

export function Card({ className = '', ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-3xl border border-ink-700/70 bg-ink-900 p-4 ${className}`}
      {...props}
    />
  );
}

export function SectionTitle({ className = '', ...props }: TextProps & { className?: string }) {
  return (
    <Text
      className={`mb-3 text-xs font-semibold uppercase tracking-[2px] text-ink-600 ${className}`}
      {...props}
    />
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, { container: string; label: string }> = {
  primary: { container: 'bg-lotus-500 active:bg-lotus-600', label: 'text-white' },
  secondary: { container: 'bg-ink-800 active:bg-ink-700', label: 'text-white' },
  ghost: { container: 'bg-transparent border border-ink-700 active:bg-ink-800', label: 'text-ink-600' },
  danger: { container: 'bg-transparent border border-owing/40 active:bg-owing/10', label: 'text-owing' },
};

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  className?: string;
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  { title, variant = 'primary', loading = false, disabled, className = '', ...props },
  ref
) {
  const styles = BUTTON_STYLES[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
      disabled={isDisabled}
      className={`h-12 flex-row items-center justify-center rounded-2xl px-5 ${styles.container} ${isDisabled ? 'opacity-40' : ''} ${className}`}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text className={`text-base font-semibold ${styles.label}`}>{title}</Text>
      )}
    </Pressable>
  );
});

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'open' | 'locked' | 'resolved' | 'cancelled' | 'win' | 'loss';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-800 text-ink-600',
    open: 'bg-lotus-500/15 text-lotus-400',
    locked: 'bg-amber-500/15 text-amber-400',
    resolved: 'bg-ink-800 text-ink-600',
    cancelled: 'bg-ink-800 text-ink-600',
    win: 'bg-owed/15 text-owed',
    loss: 'bg-owing/15 text-owing',
  };

  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${tones[tone]?.split(' ')[0]}`}>
      <Text className={`text-2xs font-bold uppercase tracking-wider ${tones[tone]?.split(' ')[1]}`}>
        {label}
      </Text>
    </View>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-ink-700"
    >
      <Text style={{ fontSize: size * 0.36 }} className="font-bold text-ink-500">
        {initials(name)}
      </Text>
    </View>
  );
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <View className="flex-row items-center">
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={{ marginLeft: index === 0 ? 0 : -8 }}>
          <Avatar name={name} size={24} />
        </View>
      ))}
      {extra > 0 && (
        <Text className="ml-2 text-xs text-ink-600">+{extra}</Text>
      )}
    </View>
  );
}

export function EmptyState({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <View className="items-center px-8 py-12">
      <Text className="mb-3 text-4xl">{emoji}</Text>
      <Text className="mb-1 text-center text-base font-semibold text-white">{title}</Text>
      <Text className="text-center text-sm leading-5 text-ink-600">{body}</Text>
    </View>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-owing/30 bg-owing/10 px-4 py-3">
      <Text className="text-sm text-owing">{message}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <ActivityIndicator color={colors.lotus['500']} />
      <Text className="text-sm text-ink-600">{label}</Text>
    </View>
  );
}
