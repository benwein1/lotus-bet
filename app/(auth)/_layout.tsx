import { Stack } from 'expo-router';

import { colors } from '@/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ink['950'] },
        animation: 'slide_from_right',
      }}
    />
  );
}
