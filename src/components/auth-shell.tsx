import { useEffect } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from '@/components/animated';

import { AppMark, WordmarkGlow } from '@/components/app-mark';
import { ContentWidth, Screen } from '@/components/screen';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { motion } from '@/theme';

/**
 * The frame every screen before sign-in sits in.
 *
 * Sign-in, sign-up and profile setup used to each carry their own copy of the
 * mark, the headline, the scroll, the keyboard handling and the disclaimer.
 * Three copies drift — and the drift showed, because moving between them is
 * the first thing anyone does with the app and the mark jumped a few pixels
 * each time. One shell means the hero is literally the same object in the same
 * place, so the route change reads as the *form* sliding under a fixed mark
 * rather than as three separate screens.
 *
 * This shell used to carry the money disclaimer as a footnote under the form,
 * and every other screen carried its own copy. The statement still exists and
 * is still a product commitment — it lives once, in Settings, under Money, and
 * in the terms. Repeating it on the way in made the first thing the app says
 * about itself a denial. Do not add it back here; add to the Settings block.
 */
/**
 * The bloom's box, drawn around the 84pt mark.
 *
 * Wider than tall because the light reads as coming from the petals' spread
 * rather than from a point, and both numbers are a little over twice the mark
 * so the fade has finished well before the headline underneath.
 */
const HALO = { width: 230, height: 190 } as const;

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  /**
   * Replaces the app mark at the top. Profile setup swaps in the user's own
   * avatar, because by then the thing being introduced is them, not the app.
   */
  hero,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  hero?: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  // The hero gives way to the keyboard rather than being shoved off the top of
  // the screen by it. Scale and opacity only — animating the mark's *height*
  // would re-lay-out the whole column every frame (CLAUDE.md §4).
  const compact = useSharedValue(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, () => {
      compact.value = reduced ? 1 : withSpring(1, motion.settle);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      compact.value = reduced ? 0 : withSpring(0, motion.settle);
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [compact, reduced]);

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - compact.value * 0.3 }],
  }));

  // The sentence explaining the app is the first thing to go: by the time
  // somebody is typing, they have read it.
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: 1 - compact.value,
    transform: [{ translateY: -compact.value * 4 }],
  }));

  const entering = (delay: number) =>
    reduced ? FadeIn.duration(motion.duration.fast) : FadeInDown.delay(delay).duration(420);

  return (
    <Screen>
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow justify-center px-gutter py-8"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <ContentWidth>
              <Animated.View entering={entering(0)} className="mb-9 items-center">
                {/* The bloom behind the mark.
                    `WordmarkGlow` already draws exactly this for the feed
                    header, so the entrance borrows it rather than growing a
                    second one: a radial fade to nothing, drawn rather than
                    faked with a tinted pill, which at low opacity has a hard
                    edge that reads as a chip behind the logo.

                    It is absolutely positioned and centred so it adds no
                    height — the mark stays exactly where the splash hands it
                    over, which is the whole reason this shell exists. It also
                    sits outside `markStyle`, so the keyboard shrinking the mark
                    does not shrink the light around it. */}
                <View className="mb-6">
                  <Animated.View style={markStyle}>
                    <View
                      pointerEvents="none"
                      className="absolute inset-0 items-center justify-center"
                    >
                      <WordmarkGlow width={HALO.width} height={HALO.height} />
                    </View>
                    {hero ?? <AppMark size={84} />}
                  </Animated.View>
                </View>

                {/* Large Title, centred, with the tight tracking the scale
                    already applies at this size. One statement, not a slogan
                    stack. */}
                <Text className="text-center text-3xl font-bold text-primary">{title}</Text>

                <Animated.View style={subtitleStyle}>
                  <Text className="mt-3 max-w-[310px] text-center text-callout leading-[22px] text-secondary">
                    {subtitle}
                  </Text>
                </Animated.View>
              </Animated.View>

              <Animated.View entering={entering(90)}>{children}</Animated.View>

              <View className="mt-10 items-center gap-5">
                {footer}
              </View>
            </ContentWidth>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

/**
 * The quiet line under a form that offers the other way in.
 *
 * A sentence with one pressable word, rather than a second button competing
 * with the primary one — there is only ever one thing you came here to do.
 */
export function AuthSwitch({ prompt, children }: { prompt: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-center gap-1">
      <Text className="text-subhead text-secondary">{prompt}</Text>
      {children}
    </View>
  );
}

/** A success/notice panel in the accent tint, for "check your inbox" moments. */
export function AuthNotice({ message }: { message: string }) {
  return (
    <Animated.View entering={FadeIn.duration(180)} className="mt-4">
      <View className="rounded-2xl bg-accent-soft px-4 py-3">
        <Text className="text-subhead leading-5 text-accent">{message}</Text>
      </View>
    </Animated.View>
  );
}
