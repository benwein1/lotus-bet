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
  }
);
