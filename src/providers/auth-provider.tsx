import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { UserRow } from '@/lib/database.types';
import { demo, demoProfile, demoSession, disableDemoMode, enableDemoMode, isDemoMode } from '@/lib/demo';
import { normalisePhone } from '@/lib/format';
import { registerForPushNotifications } from '@/lib/notifications';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  profile: UserRow | null;
  /** True until the persisted session has been read back from storage. */
  loading: boolean;
  /** A signed-in user who has not picked a display name yet. */
  needsProfileSetup: boolean;
  sendOtp: (phone: string) => Promise<{ phone: string }>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  updateProfile: (patch: Partial<Pick<UserRow, 'display_name' | 'avatar_url' | 'notify_new_bets' | 'notify_resolutions'>>) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /** TEMPORARY: sign in against in-memory data, with no backend. */
  enterDemo: () => void;
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
      // The signup trigger seeds a placeholder name; anything starting with
      // "Player " means the user has not introduced themselves yet.
      demo: demoActive,
      needsProfileSetup:
        !demoActive &&
        Boolean(session) &&
        Boolean(profile) &&
        /^Player \d{0,4}$/.test(profile!.display_name),

      enterDemo() {
        enableDemoMode();
        setSession(demoSession as unknown as Session);
        setProfile(demoProfile);
        setDemoActive(true);
        setLoading(false);
      },

      async sendOtp(rawPhone: string) {
        const phone = normalisePhone(rawPhone);
        if (!phone) throw new Error('That does not look like a phone number.');

        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw new Error(error.message);

        return { phone };
      },

      async verifyOtp(phone: string, token: string) {
        const { error } = await supabase.auth.verifyOtp({
          phone,
          token: token.trim(),
          type: 'sms',
        });
        if (error) throw new Error(error.message);
      },

      async updateProfile(patch) {
        if (demoActive) {
          setProfile(await demo.updateProfile(patch));
          return;
        }
        if (!session?.user.id) throw new Error('Not signed in.');

        const { data, error } = await supabase
          .from('users')
          .update(patch)
          .eq('id', session.user.id)
          .select()
          .single<UserRow>();

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
