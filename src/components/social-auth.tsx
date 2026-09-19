import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale, tap } from '@/components/ui';
import { appleSignInAvailable } from '@/lib/oauth';
import { PROVIDER_LABEL, type OAuthProvider } from '@/lib/oauth-rules';
import { useScheme } from '@/providers/theme-provider';

/**
 * "Continue with Apple" and "Continue with Google".
 *
 * ---------------------------------------------------------------------------
 * Why both, and never only one
 * ---------------------------------------------------------------------------
 * Guideline 4.8. An app that offers a third-party login has to also offer a
 * login that limits data collection to name and email and does not track — and
 * Sign in with Apple is the option Apple accepts for that by construction.
 * Shipping the Google button alone is a rejection; shipping Apple alone is
 * fine but leaves most people typing a password.
 *
 * So these are one component with one list. They are not separately toggleable
 * and there is no prop to render only Google, because that configuration is
 * the rejection.
 *
 * ---------------------------------------------------------------------------
 * Why these two are the only hardcoded colours in the app
 * ---------------------------------------------------------------------------
 * CLAUDE.md §4 says never hardcode a hex in a component, and it names the one
 * standing exception — white over a scrim, because white-on-media does not
 * follow the scheme. These are the second: a brand mark is not the app's to
 * recolour. Google's four-colour G has fixed values in its brand guidelines,
 * and Apple's mark may be black or white and nothing else.
 *
 * They do still answer to the scheme, just not through the palette: Apple's
 * own guidance is to use whichever variant contrasts with the background it
 * sits on, so the button inverts between light and dark. That is the rule
 * being followed, rather than the rule being broken.
 */

/** Height and radius matched to `Button` at `size="lg"`, which sits beside it. */
const SHELL = 'min-h-[52px] flex-row items-center justify-center gap-2.5 rounded-2xl px-6';

export function SocialAuthButtons({
  onPress,
  busy,
  /** Sign-in says "Continue with"; nothing else reads better on both screens. */
  disabled = false,
}: {
  onPress: (provider: OAuthProvider) => void;
  /** The provider currently in flight, so only its own button spins. */
  busy?: OAuthProvider | null;
  disabled?: boolean;
}) {
  const [appleReady, setAppleReady] = useState(false);

  // iOS 13+ on a real Apple platform. On Android and the web the native sheet
  // does not exist, and Apple's *web* OAuth flow needs a service ID and a key
  // that this project does not have — so the button is hidden there rather
  // than shown and failing. Guideline 4.8 is an iOS rule and iOS is where the
  // button appears, which satisfies it.
  useEffect(() => {
    let active = true;
    void appleSignInAvailable().then((ready) => {
      if (active) setAppleReady(ready);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <View className="w-full gap-3">
      {appleReady && (
        <SocialButton
          provider="apple"
          busy={busy === 'apple'}
          disabled={disabled || Boolean(busy)}
          onPress={() => onPress('apple')}
        />
      )}
      <SocialButton
        provider="google"
        busy={busy === 'google'}
        disabled={disabled || Boolean(busy)}
        onPress={() => onPress('google')}
      />
      <SocialTermsNote />
    </View>
  );
}

/**
 * The agreement, where a social sign-in can actually make it.
 *
 * Guideline 1.2 wants people to have agreed to the rules about objectionable
 * content before they can post. The email screen has a checkbox for that,
 * because it has a form to put one in. These buttons do not: one tap creates
 * the account, signs in, and lands on the feed, with nowhere in between to put
 * a control.
 *
 * So the button label *is* the agreement, and this sentence is what it refers
 * to — the standard shape, and the only honest one when the whole flow is a
 * single tap. `accept_terms` records the version immediately afterwards, so
 * what was agreed is on the row rather than only on the screen.
 *
 * `router.push` rather than a `Link` wrapping a pressable: on the web the
 * inner press fires and then the browser's own anchor activation runs after
 * it, which is CLAUDE.md §4's trap 5 and broke picking a side from the feed
 * card once already.
 */
function SocialTermsNote() {
  const router = useRouter();

  return (
    <Text className="mt-1 px-2 text-center text-sm leading-[18px] text-tertiary">
      By continuing you agree to our{' '}
      <Text
        className="text-accent"
        onPress={() => router.push('/legal/terms')}
        accessibilityRole="link"
      >
        Terms
      </Text>{' '}
      and{' '}
      <Text
        className="text-accent"
        onPress={() => router.push('/legal/privacy')}
        accessibilityRole="link"
      >
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

function SocialButton({
  provider,
  busy,
  disabled,
  onPress,
}: {
  provider: OAuthProvider;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const scheme = useScheme();
  const dark = scheme === 'dark';

  // Apple: solid, inverted against the page — black on white, white on black.
  // Google: a white (or near-black) surface with a hairline, which is what its
  // guidelines specify and which also keeps the four-colour G legible.
  const apple = provider === 'apple';
  const background = apple ? (dark ? '#FFFFFF' : '#000000') : dark ? '#131314' : '#FFFFFF';
  const label = apple ? (dark ? '#000000' : '#FFFFFF') : dark ? '#E3E3E3' : '#1F1F1F';
  const border = apple ? background : dark ? '#8E918F' : '#DADCE0';

  return (
    <PressableScale
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      // The label reads the same to a screen reader as it does on screen. Both
      // brands are specific about the wording, and "Continue with" is on each
      // of their approved lists.
      accessibilityLabel={`Continue with ${PROVIDER_LABEL[provider]}`}
      accessibilityState={{ disabled, busy }}
      className={SHELL}
      style={{
        backgroundColor: background,
        borderWidth: 1,
        borderColor: border,
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={label} />
      ) : (
        <>
          {apple ? <AppleMark color={label} /> : <GoogleMark />}
          <Text
            className="text-base font-semibold"
            style={{ color: label }}
            // The brands' own wording is a fixed string; shrinking it is
            // better than wrapping a button label onto two lines.
            numberOfLines={1}
          >
            Continue with {PROVIDER_LABEL[provider]}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

/**
 * Apple's mark.
 *
 * Deliberately not in `icons.tsx`: that set is a 24×24 stroked vocabulary the
 * app owns and recolours freely, and this is somebody else's trademark with
 * rules about how it may be drawn. It takes a colour because Apple permits
 * exactly two — black and white — and the button picks between them.
 */
function AppleMark({ color }: { color: string }) {
  return (
    <Svg width={17} height={20} viewBox="0 0 17 20" accessibilityRole="image">
      <Path
        fill={color}
        d="M14.03 10.6c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.61-1.7-3.18-1.73-1.35-.14-2.64.79-3.33.79-.69 0-1.75-.77-2.87-.75-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.33 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.29-.88-2.31-3.5zM11.86 3.9c.6-.74 1.01-1.75.9-2.76-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.58-1.23z"
      />
    </Svg>
  );
}

/**
 * Google's "G".
 *
 * Four fixed brand colours, identical in both schemes — the mark is the same
 * object on a white button and on a dark one, and tinting it would be the one
 * thing its guidelines are least ambiguous about.
 */
function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" accessibilityRole="image">
      <Path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <Path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <Path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </Svg>
  );
}

/**
 * The rule between the social buttons and the email form.
 *
 * A word in the middle of a hairline, which is the shape every sign-in screen
 * that offers both has converged on — and it is doing real work here, because
 * without it the two halves read as one stack of five controls rather than as
 * a choice between two ways in.
 */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  return (
    <View className="my-6 w-full flex-row items-center gap-3">
      <View className="h-px flex-1 bg-hairline" />
      <Text className="text-sm text-tertiary">{label}</Text>
      <View className="h-px flex-1 bg-hairline" />
    </View>
  );
}
