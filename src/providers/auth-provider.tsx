import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import type { UserRow } from '@/lib/database.types';
import { demo, demoProfile, demoSession, disableDemoMode, enableDemoMode, isDemoMode } from '@/lib/demo';
import { passwordResetRedirectTo } from '@/lib/invites';
import { clearMediaCache } from '@/lib/media';
import { registerForPushNotifications } from '@/lib/notifications';
import { prepareContent } from '@/lib/content-rules';
import { TERMS_VERSION } from '@/lib/legal';
import { isUnknownWriteColumn } from '@/lib/postgrest';
import { USER_COLUMNS } from '@/lib/queries';
import { isRecoveryRedirect, recoveryTokens } from '@/lib/auth-links';
import { isSupabaseConfigured, openedWithUrl, setSessionLostHandler, supabase } from '@/lib/supabase';

export interface SignUpResult {
  /** True when the project has email confirmation on and no session was issued. */
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  session: Session | null;
  profile: UserRow | null;
  /** True until the persisted session has been read back from storage. */
  loading: boolean;
  /** A signed-in user who has not picked a display name yet. */
  needsProfileSetup: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<SignUpResult>;
  sendPasswordReset: (email: string) => Promise<void>;
  /**
   * True between clicking a reset link and setting a new password.
   *
   * Supabase signs you in when you open a recovery link — the session is real,
   * which is what lets `updateUser` work. Without a flag, the redirect gate
   * would see a valid session and drop you on the feed, and you would still
   * not know your password. This is what keeps you on the reset screen.
   */
  recovering: boolean;
  updatePassword: (password: string) => Promise<void>;
  updateProfile: (
    patch: Partial<
      Pick<
        UserRow,
        | 'display_name'
        | 'avatar_url'
        | 'notify_new_bets'
        | 'notify_resolutions'
        | 'notify_group_joins'
        | 'notify_deadlines'
      >
    >
  ) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /** TEMPORARY: sign in against in-memory data, with no backend. */
  enterDemo: (fresh?: boolean) => void;
  demo: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserRow | null>(null);
  // Latched from the opening URL rather than waited for as an event. GoTrue
  // emits PASSWORD_RECOVERY from inside its own initialisation, which can beat
  // this component's subscription, and it strips the fragment once it has read
  // it — so the event is a race and the URL is not. `openedWithUrl` was
  // captured before the client was built precisely so this can read it.
  const [recovering, setRecovering] = useState(
    () => Boolean(openedWithUrl && isRecoveryRedirect(openedWithUrl))
  );
  const [loading, setLoading] = useState(true);
  const [demoActive, setDemoActive] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    // Named columns, never `*`. `email`, `phone` and `expo_push_token` are
    // revoked from `authenticated` at the column level, and `select *` on a
    // table with a revoked column is a hard error rather than a narrower row —
    // see USER_COLUMNS and `…_user_column_privileges.sql`.
    const { data, error } = await supabase
      .from('users')
      .select(USER_COLUMNS)
      .eq('id', userId)
      .maybeSingle<UserRow>();

    if (error) {
      console.warn('Could not load profile', error.message);
      return;
    }
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || isDemoMode()) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next) setProfile(null);

      // Opening a reset link fires PASSWORD_RECOVERY with a live session.
      // Latch it; `updatePassword` is the only thing that clears it.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // A 401 from anything other than the auth endpoints means this session is
  // gone — expired, revoked, or its account deleted on another device. Without
  // this the app keeps looking signed in while every screen quietly fails, and
  // the only way out is to find Sign out and use it on a dead session.
  //
  // `supabase.auth.signOut()` is deliberately not called: it would POST to
  // GoTrue with the same dead token and fail. Dropping the local session is
  // what actually ends it, and the redirect gate does the rest.
  useEffect(() => {
    return setSessionLostHandler(() => {
      // Signed URLs were minted for the session that just died. The next
      // person on this device must not inherit them — same reason `signOut`
      // clears them.
      clearMediaCache();
      setSession(null);
      setProfile(null);
      setRecovering(false);
    });
  }, []);

  // The native half of a reset link.
  //
  // `detectSessionInUrl` is a web-only mechanism, so on a device the tokens
  // arrive in a `lotusbet://reset-password#…` deep link that nothing consumes.
  // Lift them out and hand them to `setSession` by hand — and latch *first*,
  // because `setSession` announces itself as an ordinary SIGNED_IN and the
  // redirect gate would otherwise get a frame in which it drops you on the
  // feed, which is the exact bug this flow exists to fix.
  useEffect(() => {
    if (Platform.OS === 'web' || !isSupabaseConfigured || isDemoMode()) return;

    let active = true;

    const handle = async (url: string | null) => {
      if (!url || !active) return;
      const tokens = recoveryTokens(url);
      if (!tokens) return;

      setRecovering(true);
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      // A link that has expired or been used already fails here. Drop the
      // latch so the reset screen says so instead of holding an empty form.
      if (active && error) setRecovering(false);
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => void handle(url));

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!session?.user.id || isDemoMode()) return;
    void loadProfile(session.user.id);
    // Refreshes the token for somebody who has *already* granted permission,
    // and does nothing at all otherwise. It deliberately cannot trigger the
    // system dialog any more: `NotificationPrimer` on the feed owns that, so
    // the ask arrives with an explanation and after the user has seen a bet.
    void registerForPushNotifications();
  }, [session?.user.id, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      recovering,
      loading,
      demo: demoActive,
      needsProfileSetup:
        !demoActive && Boolean(session) && Boolean(profile) && !profileIsComplete(profile!),

      enterDemo(fresh = false) {
        enableDemoMode(fresh);
        setSession(demoSession as unknown as Session);
        setProfile(demoProfile);
        setDemoActive(true);
        setLoading(false);
      },

      async signIn(email: string, password: string) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async signUp(email: string, password: string, displayName: string) {
        // The same check `updateProfile` applies, because this is the other way
        // a display name gets set. `handle_new_auth_user` copies this straight
        // into `public.users`, so an unchecked name here would walk past the
        // rule entirely.
        const checked = prepareContent(displayName, { strict: true });
        if (!checked.ok) throw new Error(checked.message);

        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          // The signup trigger reads this to seed public.users, so a new
          // account arrives with its name and its terms acceptance already
          // set. Carried here rather than written afterwards because a second
          // call has a hole in the middle: a client that dies between them
          // leaves an account with no acceptance and nothing to fix it.
          options: {
            data: { display_name: checked.text, terms_version: TERMS_VERSION },
          },
        });
        if (error) throw new Error(friendlyAuthError(error.message));

        return { needsEmailConfirmation: data.session === null };
      },

      async sendPasswordReset(email: string) {
        // Without `redirectTo`, Supabase sends people to the project's Site URL
        // — which lands them on the app's root with a recovery token in the
        // fragment and no screen expecting it. Naming the route means the link
        // opens the one screen that can actually finish the job.
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: passwordResetRedirectTo() }
        );
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async updatePassword(password: string) {
        // Demo mode has no GoTrue to talk to. Pretend it worked and release the
        // latch, so the screen can be walked without a project behind it.
        if (demoActive) {
          setRecovering(false);
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(friendlyAuthError(error.message));
        // The session is already signed in at full strength — recovery only
        // ever described how it started. Clearing the latch releases the gate.
        setRecovering(false);
      },

      async updateProfile(patch) {
        if (demoActive) {
          setProfile(await demo.updateProfile(patch));
          return;
        }
        if (!session?.user.id) throw new Error('Not signed in.');

        // A display name is the one piece of text that follows you onto every
        // screen anybody sees, so it gets the strict threshold. Checked here
        // rather than in the screen because there are two screens that set it
        // — profile setup and Profile — and a rule enforced in one of them is
        // not a rule.
        let named = patch;
        if (patch.display_name !== undefined) {
          const checked = prepareContent(patch.display_name ?? '', { strict: true });
          if (!checked.ok) throw new Error(checked.message);
          named = { ...patch, display_name: checked.text };
        }

        // Naming yourself is what completes the profile, so the two always
        // move together.
        const full = named.display_name ? { ...named, profile_completed: true } : named;

        const write = (values: Record<string, unknown>) =>
          supabase
            .from('users')
            .update(values)
            .eq('id', session.user.id)
            // The RETURNING clause is a read, and reads name their columns.
            .select(USER_COLUMNS)
            .single<UserRow>();

        let { data, error } = await write(full);

        // A project that has not had `…_email_auth.sql` applied has no
        // `profile_completed` column, and PostgREST rejects the whole write
        // rather than ignoring the unknown key. Retry with just the columns
        // that schema does have, so naming yourself still works — the
        // placeholder-name fallback in `profileIsComplete` then carries it.
        if (error && isUnknownWriteColumn(error, 'profile_completed')) {
          ({ data, error } = await write(named));
        }

        if (error) throw new Error(error.message);
        setProfile(data);
      },

      async refreshProfile() {
        if (demoActive) {
          setProfile(demo.currentProfile());
          return;
        }
        if (session?.user.id) await loadProfile(session.user.id);
      },

      async signOut() {
        // Signed media URLs are minted against the session that is going away.
        // Whoever uses this device next must not inherit a working link to the
        // last person's photos.
        clearMediaCache();

        if (demoActive) {
          disableDemoMode();
          setDemoActive(false);
          setSession(null);
          setProfile(null);
          return;
        }
        await supabase.auth.signOut();
        setProfile(null);
      },
    }),
    [session, profile, loading, demoActive, loadProfile, recovering]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Whether the user has named themselves.
 *
 * `profile_completed` is the real answer, but the column only exists once
 * `…_email_auth.sql` has been applied. Against the older schema the value is
 * simply absent, so fall back to what that schema encoded: the signup trigger
 * named every new account `Player <4 chars>`, and anything else is a name the
 * user chose.
 */
function profileIsComplete(profile: UserRow): boolean {
  if (typeof profile.profile_completed === 'boolean') return profile.profile_completed;
  return !/^player [0-9a-f]{0,4}$/i.test(profile.display_name.trim());
}

/**
 * Supabase returns accurate but unfriendly strings. These are the three a user
 * actually hits; everything else passes through unchanged.
 */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'There is already an account with that email. Try signing in.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirm your email address first — check your inbox for the link.';
  }
  return message;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}

/** Convenience for screens that are only reachable when signed in. */
export function useCurrentUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('No signed-in user');
  return session.user.id;
}
