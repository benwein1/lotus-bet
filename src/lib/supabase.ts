import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when the app has been pointed at a Supabase project. The UI checks this
 * so a fresh clone shows a "finish setting up" screen instead of crashing on a
 * malformed URL.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * The URL this page was opened with, captured before the client exists.
 *
 * `detectSessionInUrl` strips the fragment the moment it has read it, and it
 * starts the moment `createClient` runs. Anything that needs to know what the
 * link said — the password-reset gate does, because it has to latch before a
 * recovery session can be mistaken for an ordinary one — has to read the URL
 * first or it reads an already-cleaned one and sees nothing. Module statements
 * run in order, so this line being above `createClient` is the guarantee.
 */
export const openedWithUrl =
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null;

/**
 * Told when a request comes back 401 from something other than the auth
 * endpoints — a session that has expired, been revoked, or whose account was
 * deleted on another device.
 *
 * A module-level slot rather than an event emitter because there is exactly
 * one legitimate listener (the auth provider) and exactly one right response
 * (sign out). Registering a second would be a bug, and this shape makes that
 * obvious.
 */
let onSessionLost: (() => void) | null = null;

/** Registered by `AuthProvider`. Returns the unsubscribe. */
export function setSessionLostHandler(handler: () => void): () => void {
  onSessionLost = handler;
  return () => {
    if (onSessionLost === handler) onSessionLost = null;
  };
}

/**
 * The global 401 handler — APP_STORE.md §1 gap 8.
 *
 * Without it a revoked session surfaces as whatever screen happened to ask
 * first, showing a generic failure while the app still looks signed in: the
 * feed is empty, the Profile is blank, and nothing says why or offers the one
 * action that helps. The user's only route out is to find Sign out and use it
 * on a session that is already dead.
 *
 * It lives in `fetch` rather than in `queries.ts` because that is the only
 * place that still has the **status code**. By the time PostgREST's body has
 * become `new Error(error.message)`, the 401 is a string that has to be
 * pattern-matched — which `errors.ts` does as a fallback, but matching a
 * number is better than matching prose.
 *
 * `/auth/v1/` is excluded on purpose: a wrong password is a 401 too, and
 * signing somebody out because they mistyped it would be absurd. A genuinely
 * dead refresh token still reaches us, because supabase-js reports that
 * through `onAuthStateChange` instead.
 */
const fetchWithSessionCheck: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);

  if (response.status === 401) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (!url.includes('/auth/v1/')) onSessionLost?.();
  }

  return response;
};

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // On the web this is how a password-reset link turns into a session:
      // GoTrue lands on `/reset-password#access_token=…&type=recovery` and
      // nothing else is going to read that fragment. Off on native, where
      // there is no URL bar to parse and the deep link is handled by hand in
      // `auth-provider` instead.
      detectSessionInUrl: Platform.OS === 'web',
    },
    global: { fetch: fetchWithSessionCheck },
  }
);
