import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useColors } from '@/providers/theme-provider';
import { MINIMUM_AGE, type DateParts } from '@/lib/age';

/**
 * Date of birth, as three boxes in the shape of a `TextField` row.
 *
 * **Three boxes rather than a date picker**, and that is a deliberate trade.
 * A wheel picker opens on today and needs somewhere between sixteen and sixty
 * years of scrolling to reach a birth year; the native date picker is a
 * different component on each platform and has no web equivalent worth
 * shipping. Typing six digits is faster than all of it, and the keyboard is
 * already up because this sits under a form.
 *
 * It borrows `TextField`'s metrics — the 86px leading label, the 48px row, the
 * hairline underneath — rather than importing it, because `TextField` wraps one
 * input and this needs three that advance between themselves.
 *
 * The value is held as parts, not as a string or a `Date`. Parsing "07/03/2010"
 * means deciding whether that is March or July, and building a `Date` from it
 * reintroduces the timezone shift `src/lib/age.ts` exists to avoid.
 */

export interface DateOfBirthHandle {
  focus: () => void;
}

interface Props {
  value: Partial<DateParts>;
  onChange: (next: Partial<DateParts>) => void;
  /** Called when the year box is filled, so the parent can submit or move on. */
  onComplete?: () => void;
  last?: boolean;
}

/** Digits only, capped, and `undefined` for an empty box rather than 0. */
function digits(text: string, max: number): number | undefined {
  const cleaned = text.replace(/[^0-9]/g, '').slice(0, max);
  return cleaned.length === 0 ? undefined : Number(cleaned);
}

export const DateOfBirthField = forwardRef<DateOfBirthHandle, Props>(
  function DateOfBirthField({ value, onChange, onComplete, last = false }, ref) {
    const colors = useColors();
    const [focused, setFocused] = useState(false);

    const dayRef = useRef<TextInput>(null);
    const monthRef = useRef<TextInput>(null);
    const yearRef = useRef<TextInput>(null);

    useImperativeHandle(ref, () => ({ focus: () => dayRef.current?.focus() }), []);

    const box = 'h-12 text-base text-primary text-center';

    return (
      <View>
        <View className="flex-row items-center gap-3 px-4">
          <Text
            className={`w-[86px] py-3 text-base ${focused ? 'text-accent' : 'text-secondary'}`}
            // The three boxes each carry their own label for a screen reader,
            // so this one is decorative to it and would otherwise be read a
            // fourth time.
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            Born
          </Text>

          <View className="flex-1 flex-row items-center">
            <TextInput
              ref={dayRef}
              value={value.day === undefined ? '' : String(value.day)}
              onChangeText={(t) => {
                const day = digits(t, 2);
                onChange({ ...value, day });
                // Advance on the second digit, or on a first digit that cannot
                // be the start of a two-digit day. Typing "7" then waiting is
                // as common as typing "07".
                if (t.replace(/[^0-9]/g, '').length === 2 || (day !== undefined && day > 3)) {
                  monthRef.current?.focus();
                }
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="DD"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              returnKeyType="next"
              accessibilityLabel="Day of birth"
              className={`${box} w-[44px]`}
              // A TextInput sharing a row will not shrink without this — it
              // sets a zero basis but keeps `min-width: auto`. CLAUDE.md §4
              // gotcha 4b, which has now bitten three times.
              style={{ minWidth: 0 }}
            />
            <Text className="px-1 text-base text-tertiary">/</Text>

            <TextInput
              ref={monthRef}
              value={value.month === undefined ? '' : String(value.month)}
              onChangeText={(t) => {
                const month = digits(t, 2);
                onChange({ ...value, month });
                if (t.replace(/[^0-9]/g, '').length === 2 || (month !== undefined && month > 1)) {
                  yearRef.current?.focus();
                }
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="MM"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              returnKeyType="next"
              accessibilityLabel="Month of birth"
              className={`${box} w-[48px]`}
              style={{ minWidth: 0 }}
            />
            <Text className="px-1 text-base text-tertiary">/</Text>

            <TextInput
              ref={yearRef}
              value={value.year === undefined ? '' : String(value.year)}
              onChangeText={(t) => {
                const cleaned = t.replace(/[^0-9]/g, '');
                onChange({ ...value, year: digits(t, 4) });
                if (cleaned.length === 4) onComplete?.();
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="YYYY"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.accent}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={4}
              returnKeyType="go"
              onSubmitEditing={onComplete}
              accessibilityLabel="Year of birth"
              className={`${box} w-[70px]`}
              style={{ minWidth: 0 }}
            />
          </View>
        </View>
        {!last && <View className="ml-4 h-px bg-hairline" />}
      </View>
    );
  }
);

/**
 * The sentence that says why the app is asking, and what it does not keep.
 *
 * Shared by the sign-up form and the one-time check so the promise is worded
 * identically in both — it is the same promise, and `confirm_minimum_age` is
 * what makes it true.
 */
export const AGE_FOOTNOTE =
  `Betta is for ages ${MINIMUM_AGE} and over. We check your date of birth and do not store it.`;
