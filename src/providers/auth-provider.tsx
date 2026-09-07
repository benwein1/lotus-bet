import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { UserRow } from '@/lib/database.types';
import { demo, demoProfile, demoSession, disableDemoMode, enableDemoMode, isDemoMode } from '@/lib/demo';
import { registerForPushNotifications } from '@/lib/notifications';
import { isUnknownWriteColumn } from '@/lib/postgrest';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

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
  updateProfile: (
    patch: Partial<
      Pick<UserRow, 'display_name' | 'avatar_url' | 'notify_new_bets' | 'notify_resolutions'>
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
  const [loading, setLoading] = useState(true);
  const [demoActive, setDemoActive] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
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

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setProfile(null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user.id || isDemoMode()) return;
    void loadProfile(session.user.id);
    // Push registration is best-effort: it no-ops on simulators and when the
    // user declines the permission prompt.
    void registerForPushNotifications();
  }, [session?.user.id, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
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
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          // The signup trigger reads this to seed public.users, so a new
          // account arrives with its name already set.
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) throw new Error(friendlyAuthError(error.message));

        return { needsEmailConfirmation: data.session === null };
      },

      async sendPasswordReset(email: string) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      async updateProfile(patch) {
        if (demoActive) {
          setProfile(await demo.updateProfile(patch));
          return;
        }
        if (!session?.user.id) throw new Error('Not signed in.');

        // Naming yourself is what completes the profile, so the two always
        // move together.
        const full = patch.display_name ? { ...patch, profile_completed: true } : patch;

        const write = (values: Record<string, unknown>) =>
          supabase
            .from('users')
            .update(values)
            .eq('id', session.user.id)
            .select()
            .single<UserRow>();

        let { data, error } = await write(full);

        // A project that has not had `…_email_auth.sql` applied has no
        // `profile_completed` column, and PostgREST rejects the whole write
        // rather than ignoring the unknown key. Retry with just the columns
        // that schema does have, so naming yourself still works — the
        // placeholder-name fallback in `profileIsComplete` then carries it.
        if (error && isUnknownWriteColumn(error, 'profile_completed')) {
          ({ data, error } = await write(patch));
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
    [session, profile, loading, demoActive, loadProfile]
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
