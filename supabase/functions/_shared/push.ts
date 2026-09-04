// Minimal Expo push client. Expo's HTTP API takes up to 100 messages a call.
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Fire-and-forget delivery. A failed push must never fail the surrounding
 * request — resolving a bet still succeeded even if a phone is unreachable.
 */
export async function sendPushNotifications(messages: PushMessage[]): Promise<void> {
  const valid = messages.filter((m) => m.to && m.to.startsWith('ExponentPushToken'));
  if (valid.length === 0) return;

  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(
          chunk.map((m) => ({ ...m, sound: 'default', priority: 'high' }))
        ),
      });
      if (!res.ok) {
        console.error('Expo push rejected batch', res.status, await res.text());
      }
    } catch (err) {
      console.error('Expo push request failed', err);
    }
  }
}
