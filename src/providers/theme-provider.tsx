import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorScheme as nativewindColorScheme, useColorScheme } from 'nativewind';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { colorsFor, type ColorScheme, type Palette } from '@/theme';

export type AppearancePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'lotusbet.appearance';

interface ThemeContextValue {
  /** What the user asked for. */
  preference: AppearancePreference;
  /** What is actually on screen right now. */
  scheme: ColorScheme;
  colors: Palette;
  setPreference: (next: AppearancePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the colour scheme.
 *
 * NativeWind resolves every `bg-canvas`/`text-primary` class against the
 * scheme it holds, so this provider only has to keep that in sync with the
 * user's choice and hand the raw palette to the places a class cannot reach
 * (navigator options, SVG, `placeholderTextColor`, animated styles).
 *
 * `darkMode: 'class'` in tailwind.config.js is what makes `setColorScheme`
 * authoritative — under the default `media` the system would win, and there
 * would be no way to offer the override at all.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const system = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');

  // Restore the stored choice. Until it lands the app follows the system,
  // which is the right answer for a first launch anyway.
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (active && isPreference(stored)) setPreferenceState(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  // Always hand NativeWind a concrete scheme rather than "system". Under
  // `darkMode: 'class'` nothing watches the OS setting on the web — the class
  // has to be set explicitly — so resolving "system" here is what makes the
  // two platforms behave the same way.
  useEffect(() => {
    const resolved: ColorScheme =
      preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    setColorScheme(resolved);
  }, [preference, system, setColorScheme]);

  const scheme: ColorScheme = colorScheme === 'dark' ? 'dark' : 'light';

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      scheme,
      colors: colorsFor(scheme),
      setPreference(next) {
        setPreferenceState(next);
        void AsyncStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [preference, scheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function isPreference(value: string | null): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function useAppearance(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppearance must be used inside a ThemeProvider');
  return ctx;
}

/** The active palette. The common case — most callers only want colours. */
export function useColors(): Palette {
  return useAppearance().colors;
}

/** The active scheme, for the handful of places that branch on it directly. */
export function useScheme(): ColorScheme {
  return useAppearance().scheme;
}

/**
 * Read the scheme outside React. Used by the root layout before the provider
 * mounts, and nowhere else — components use the hooks.
 */
export function currentScheme(): ColorScheme {
  return nativewindColorScheme.get() === 'dark' ? 'dark' : 'light';
}
