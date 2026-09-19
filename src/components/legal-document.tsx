import { Stack } from 'expo-router';
import { Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ContentWidth, Screen } from '@/components/screen';
import {
  SUPPORT_CONTACT_PUBLISHED,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
  legalDocument,
  type LegalSlug,
} from '@/lib/legal';

/**
 * The terms, the privacy policy and the support page, rendered in the app.
 *
 * All three come from `legal-text.json`, so what somebody agrees to on the
 * sign-up screen, what the hosted page says and what the version recorded
 * against their account refers to are the same words by construction.
 *
 * Deliberately plain. A legal document is read, not used, so it gets the
 * grouped-list ground, one column, generous leading and nothing else — no
 * cards, no accent, no motion. The one interactive element is the support
 * address, because a contact you cannot tap is a contact you will not use.
 */
export function LegalDocumentScreen({ slug }: { slug: LegalSlug }) {
  const doc = legalDocument(slug);

  return (
    <>
      <Stack.Screen options={{ title: doc.title, headerBackTitle: 'Back' }} />
      <Screen ground="sunken">
        <SafeAreaView edges={['bottom']} className="flex-1">
          <ScrollView
            contentContainerClassName="px-gutter pb-16 pt-4"
            showsVerticalScrollIndicator={false}
          >
            <ContentWidth>
              <Text className="text-2xl font-bold text-primary">{doc.title}</Text>
              <Text className="mt-1 text-sm text-tertiary">
                Version {doc.version}
              </Text>
              <Text className="mt-4 text-callout leading-[23px] text-secondary">
                {doc.summary}
              </Text>

              {doc.sections.map((section) => (
                <View key={section.heading} className="mt-section">
                  <Text className="text-lg font-semibold text-primary">
                    {section.heading}
                  </Text>
                  {section.body.map((paragraph, index) => (
                    <Paragraph key={index} text={paragraph} />
                  ))}
                </View>
              ))}
            </ContentWidth>
          </ScrollView>
        </SafeAreaView>
      </Screen>
    </>
  );
}

/**
 * One paragraph, or one bullet list.
 *
 * The prohibited-content clause is genuinely a list and reads terribly as a
 * run-on sentence, so a body entry whose lines start with a bullet is drawn as
 * one. Everything else is a paragraph.
 */
function Paragraph({ text }: { text: string }) {
  if (text.startsWith('•')) {
    const items = text
      .split('\n')
      .map((line) => line.replace(/^•\s*/, '').trim())
      .filter(Boolean);

    return (
      <View className="mt-3 gap-2">
        {items.map((item) => (
          <View key={item} className="flex-row gap-2.5">
            <Text className="text-subhead leading-[21px] text-tertiary">•</Text>
            <Text className="flex-1 text-subhead leading-[21px] text-secondary">
              {item}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <Text className="mt-3 text-subhead leading-[21px] text-secondary">
      {linkify(text)}
    </Text>
  );
}

/**
 * Makes the support address tappable where it appears in the prose.
 *
 * Only when it is actually configured: an unset deployment renders the
 * placeholder as ordinary text rather than offering to open a mail composer
 * addressed at nowhere.
 */
function linkify(text: string): React.ReactNode {
  if (!SUPPORT_CONTACT_PUBLISHED || !text.includes(SUPPORT_EMAIL)) return text;

  const parts = text.split(SUPPORT_EMAIL);
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <Text
            key={index}
            className="font-semibold text-accent"
            onPress={() => void Linking.openURL(SUPPORT_MAILTO)}
          >
            {SUPPORT_EMAIL}
          </Text>,
          part,
        ]
  );
}
