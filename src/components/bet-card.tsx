import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { memo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetActions, betSocial } from '@/components/bet-actions';
import { BetCoverView } from '@/components/bet-cover';
import { BetMediaView } from '@/components/bet-media';
import { GroupGlyph } from '@/components/group-glyph';
import { ClockIcon, LockIcon } from '@/components/icons';
import { OddsBar, type OddsSlice } from '@/components/odds-bar';
import { Badge, LiveDot, Money, PressableScale, tap } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { shareBet } from '@/lib/invites';
import type { BetSide, BetStatus, BetWithPositions } from '@/lib/database.types';
import { formatCountdown } from '@/lib/format';
import { useColors, useScheme } from '@/providers/theme-provider';
import { elevation, motion, optionColor, tabular } from '@/theme';

const STATUS_TONE: Record<BetStatus, 'open' | 'locked' | 'resolved' | 'cancelled'> = {
  open: 'open',
  locked: 'locked',
  resolved: 'resolved',
  cancelled: 'cancelled',
};

/**
 * A bet's options with a headcount each, in display order — what the odds bar
 * and every roster on the bet screen are drawn from.
 *
 * Defensive about `options` being empty: the database guarantees at least two
 * through a trigger, but a bet read by a client that has not refreshed since
 * the options migration would have none, and an empty odds bar is a better
 * outcome than a crash.
 */
export function betSlices(bet: BetWithPositions): OddsSlice[] {
  const positions = bet.positions ?? [];
  const options = [...(bet.options ?? [])].sort((a, b) => a.position - b.position);

  return options.map((option) => ({
    id: option.id,
    label: option.label,
    count: positions.filter((p) => p.option_id === option.id).length,
  }));
}

/** The option this user backed, if any. */
export function myOptionId(bet: BetWithPositions, userId: string): string | null {
  return (bet.positions ?? []).find((p) => p.user_id === userId)?.option_id ?? null;
}

/** The label of the option this user backed. */
export function myOptionLabel(bet: BetWithPositions, userId: string): string | null {
  const id = myOptionId(bet, userId);
  return (bet.options ?? []).find((o) => o.id === id)?.label ?? null;
}

/** The label of the option that won, once it has been called. */
export function winningLabel(bet: BetWithPositions): string | null {
  return (bet.options ?? []).find((o) => o.id === bet.winning_option_id)?.label ?? null;
}

/**
 * The feed card — one bet, most of a screen.
 *
 * When the bet has a photo or video it fills the frame and everything else
 * sits on top of it, the way a post reads anywhere else. Without media the
 * card falls back to type: the question gets the whole card, because on a
 * text-only bet the question *is* the content.
 */
function FeedCardImpl({
  bet,
  currentUserId,
  height,
  active = false,
  isNew = false,
  onPickOption,
  busyOptionId = null,
  onToggleLike,
  onOpenComments,
}: {
  bet: BetWithPositions;
  currentUserId: string;
  height: number;
  /** True when this is the card on screen — only that one plays its video. */
  active?: boolean;
  /** Posted since the user last looked at the feed. */
  isNew?: boolean;
  onPickOption?: (optionId: string) => void;
  busyOptionId?: string | null;
  onToggleLike?: (next: boolean) => Promise<void> | void;
  /**
   * Opens the thread as a sheet over the feed. Without it the card falls back
   * to pushing the bet screen, which is what every other entry point does.
   */
  onOpenComments?: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const social = betSocial(bet, currentUserId);
  const slices = betSlices(bet);
  const picked = myOptionId(bet, currentUserId);
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;
  const media = bet.media ?? [];
  const hasMedia = media.length > 0;
  // Every card has a background now — a photo when there is one, a generated
  // cover when there is not. One layout instead of two, which is what makes the
  // column read as a single stream rather than alternating photographs and
  // pages of type. See `bet-cover.tsx`.
  const joinable = bet.status === 'open' && Boolean(onPickOption);

  // A sheet when the feed offers one, the bet screen otherwise. Reading three
  // sentences should not cost you the photo you were looking at, the scroll
  // position you were at, or the video that was playing.
  const openThread = () =>
    onOpenComments
      ? onOpenComments()
      : router.push({ pathname: '/bet/[id]', params: { id: bet.id } });

  // Over an image the palette has to stop following the colour scheme: white
  // on a scrim is legible over anything, a semantic label colour is not.
  // Both a photo and a generated cover are coloured grounds under a scrim, so
  // the palette stops following the colour scheme either way: white on a scrim
  // is legible over anything, a semantic label colour is not.
  const titleClass = 'text-on-media';
  const metaClass = 'text-on-media-soft';

  return (
    <View
      style={{ height }}
      // No border, no radius, no shadow. The card used to be a bordered object
      // floating on the page; the feed reads as one continuous stream when the
      // screen edge is the only frame and the gap between posts is the only
      // separator. Instagram's shape, and the reason it scrolls the way it does.
      className="overflow-hidden bg-black"
    >
      {hasMedia ? (
        <>
          <BetMediaView media={media} active={active} className="absolute inset-0" />
          {/* Explicit rgba, never eight-digit hex: a stop that does not truly
              reach zero leaves a hard seam where the gradient ends. */}
          <LinearGradient
            colors={[
              'rgba(0,0,0,0.55)',
              'rgba(0,0,0,0.12)',
              'rgba(0,0,0,0.35)',
              'rgba(0,0,0,0.86)',
            ]}
            locations={[0, 0.32, 0.6, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
          />
        </>
      ) : (
        <>
          <BetCoverView betId={bet.id} className="absolute inset-0" />
          {/* The same scrim shape as over a photo, a little lighter because a
              cover is already a controlled ground rather than somebody's
              snapshot of a dark room. */}
          <LinearGradient
            colors={[
              'rgba(0,0,0,0.42)',
              'rgba(0,0,0,0.06)',
              'rgba(0,0,0,0.28)',
              'rgba(0,0,0,0.78)',
            ]}
            locations={[0, 0.34, 0.62, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            pointerEvents="none"
          />
        </>
      )}

      {/* The corners are 28pt, so content needs real inset to stop it crowding
          them — vertical most of all, since `justify-between` pushes the first
          and last rows hard against the edges.

          The side buttons sit *outside* the Link, not inside it. Nesting a
          button in a link is invalid markup, and on the web it costs you the
          feature outright: the inner press fires, then the browser's own
          anchor activation runs anyway and hard-navigates the document. Two
          siblings — one link, one control. */}
      <View className="flex-1 px-6 py-7">
        <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
          <PressableScale
            scaleTo={0.99}
            accessibilityRole="button"
            accessibilityLabel={`Bet: ${bet.title}`}
            className="flex-1 justify-between"
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 flex-row items-center gap-2">
                {bet.group && (
                  <>
                    <GroupGlyph
                      emoji={bet.group.emoji}
                      avatarUrl={bet.group.avatar_url}
                      name={bet.group.name}
                      size={26}
                      radius={9}
                    />
                    {/*
                      Group over creator, stacked rather than on one line. A
                      middle dot between them would be the meta string CLAUDE.md
                      §4 rules out, and at this width the two would collide on a
                      small iPhone long before a long group name ran out.

                      The creator is a line of type rather than a second avatar:
                      the glyph already carries the group, and two round things
                      in a corner is the crowding the card cannot afford.
                    */}
                    <View className="flex-1">
                      <Text numberOfLines={1} className={`text-sm ${metaClass}`}>
                        {bet.group.name}
                      </Text>
                      {bet.creator && (
                        <Text numberOfLines={1} className="text-2xs text-on-media-faint">
                          {bet.creator.username
                            ? `@${bet.creator.username}`
                            : bet.creator.display_name}
                        </Text>
                      )}
                    </View>
                  </>
                )}
              </View>
              {/* "New" displaces "Live" rather than sitting beside it: both
                  say the bet is open, and two pills in a corner is clutter. */}
              {isNew && bet.status === 'open' ? (
                <View className="flex-row items-center gap-1.5 rounded-full bg-accent px-2.5 py-1">
                  <Text className="text-xs font-semibold text-accent-ink">New</Text>
                </View>
              ) : bet.status === 'open' ? (
                <View className="flex-row items-center gap-1.5 rounded-full bg-scrim px-2.5 py-1">
                  <LiveDot />
                  <Text className="text-xs font-semibold text-on-media">Live</Text>
                </View>
              ) : (
                <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
              )}
            </View>

            {/* A spacer, not a container. The title used to live up here at
                Large Title inside a fixed-height centred box when there was no
                photo, and a long question simply ran past the bottom and lost
                its last lines with nothing on screen to say so. There is one
                title now, in the row below, where the layout sizes to the text
                instead of the text being cut to the layout. */}
            <View className="flex-1" />

            <View>
              <Text
                // Long questions get more room rather than an ellipsis: without
                // a photo to look at, the question is the whole post. Six lines
                // at this size is about 180 characters, past which a feed card
                // is the wrong place to read it and the bet screen is the right
                // one.
                numberOfLines={hasMedia ? 3 : 6}
                className={`text-2xl font-bold ${titleClass}`}
              >
                {bet.title}
              </Text>

              {/* No description here. It is the one piece of a bet that is
                  genuinely long-form, and a feed card that carries it stops
                  being a glance — the bet screen shows it in full, two lines
                  under the title, which is where somebody who wants it looks. */}

              <View className="mt-3 flex-row items-center gap-4">
                {/* The figure alone. An amount on a bet card is the pot and
                    nothing else, so the word was carrying no information the
                    position did not already carry — and it sat between the
                    number and the countdown, which is the row's real content.
                    "Total pot" is still spelled out on the bet screen. */}
                <Money
                  agorot={bet.total_pot_agorot}
                  currency={bet.group?.currency}
                  size="md"
                  tone="onMedia"
                />

                {countdown && (
                  <View className="flex-row items-center gap-1.5">
                    <ClockIcon
                      size={14}
                      color={colors.onMediaSoft}
                    />
                    <Text style={tabular} className={`text-sm ${metaClass}`}>
                      {countdown.replace('Closes in ', '')}
                    </Text>
                  </View>
                )}

                {bet.status === 'locked' && (
                  <View className="flex-row items-center gap-1.5">
                    <LockIcon
                      size={14}
                      color={colors.onMediaSoft}
                    />
                    <Text className={`text-sm ${metaClass}`}>Locked</Text>
                  </View>
                )}
              </View>

              <View className="mt-4">
                <OddsBar slices={slices} onMedia compact />
              </View>
            </View>
          </PressableScale>
        </Link>

        {joinable && (
          // Two options sit side by side; more wrap onto as many rows as they
          // need. `flex-wrap` with a basis rather than a grid, because the
          // labels are user-written and a fixed column would truncate them.
          <View className="mt-4 flex-row flex-wrap gap-2.5">
            {slices.map((slice, index) => (
              <OptionPick
                key={slice.id}
                label={slice.label}
                index={index}
                count={slices.length}
                selected={picked === slice.id}
                onMedia
                busy={busyOptionId === slice.id}
                onPress={() => {
                  tap();
                  onPickOption?.(slice.id);
                }}
              />
            ))}
          </View>
        )}

        {/* Also a sibling of the Link, for the same reason the option row is:
            a pressable inside an anchor fires twice on the web, once as the
            button and once as the browser navigating. */}
        {/*
          Three icons and nothing else.

          There used to be a second line under this row — "View all 4 comments",
          or "Add a comment" when there were none. It was doing two jobs:
          carrying the count, and inviting the first comment. The count now
          sits against the bubble where a count belongs — `BetActions` had a
          `showCommentCount` prop that existed only so this card could turn the
          number off while that line printed it, and with the line gone the
          prop had no callers left and went with it. The invitation is gone
          too, and that is the trade: the row is a row of controls now rather
          than a control and a sentence.

          The thread is unchanged behind it. Pressing the bubble still raises
          the sheet over the feed rather than pushing the bet screen, so the
          composer is one tap away exactly as it was.
        */}
        {onToggleLike && (
          <View className="mt-4">
            <BetActions
              liked={social.liked}
              likeCount={social.likeCount}
              commentCount={social.commentCount}
              onToggleLike={onToggleLike}
              onPressComments={openThread}
              onPressShare={() => {
                tap();
                // Swallowed on purpose: a share sheet the user dismissed, or a
                // browser with neither `navigator.share` nor a clipboard, is
                // not an error worth interrupting the feed for.
                void shareBet(bet.id, bet.title, bet.group?.name).catch(() => {});
              }}
              onMedia
            />
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * The card is memoised on everything except its two callbacks.
 *
 * Patching one bet's likes makes a new array, so without this every mounted
 * card re-renders — media, gradient, odds bar and all — because one number
 * moved on one of them. The callbacks are excluded deliberately: the feed
 * writes them as inline arrows, so their identity changes on every render and
 * comparing them would defeat the memo entirely. They close over nothing that
 * is not also a compared prop, so behaviour cannot go stale behind them.
 */
export const FeedCard = memo(FeedCardImpl, (prev, next) => {
  return (
    prev.bet === next.bet &&
    prev.currentUserId === next.currentUserId &&
    prev.height === next.height &&
    prev.active === next.active &&
    prev.isNew === next.isNew &&
    prev.busyOptionId === next.busyOptionId &&
    Boolean(prev.onToggleLike) === Boolean(next.onToggleLike) &&
    Boolean(prev.onPickOption) === Boolean(next.onPickOption) &&
    Boolean(prev.onOpenComments) === Boolean(next.onOpenComments)
  );
});

/**
 * Picking an option without leaving the feed.
 *
 * The colour comes from `optionColor` as an inline style rather than a class:
 * with an arbitrary number of options there is no literal class name to write,
 * and Tailwind cannot see an interpolated one. This is the case §4 leaves open
 * for reaching past a className.
 */
function OptionPick({
  label,
  index,
  count,
  selected,
  onMedia,
  busy,
  onPress,
}: {
  label: string;
  index: number;
  count: number;
  selected: boolean;
  onMedia: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const scheme = useScheme();
  const color = optionColor(index, count, scheme, onMedia);

  return (
    <PressableScale
      scaleTo={0.96}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected, busy }}
      accessibilityLabel={selected ? `Withdraw from ${label}` : `Back ${label}`}
      style={{
        backgroundColor: selected ? color : undefined,
        borderColor: selected ? color : undefined,
        // Two fill the row; three or more take half of it and wrap.
        flexBasis: count === 2 ? 0 : '47%',
        flexGrow: 1,
      }}
      className={`min-h-12 items-center justify-center rounded-2xl border px-3 py-2 ${
        selected ? '' : onMedia ? 'border-chrome-edge bg-scrim' : 'border-hairline bg-surface2'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <Text
        numberOfLines={1}
        style={selected ? undefined : { color }}
        className={`text-subhead font-semibold ${selected ? 'text-on-media' : ''}`}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * The compact card, used inside a group where a list of bets has to be
 * scannable rather than immersive.
 */
export function BetCard({
  bet,
  currentUserId,
  showGroup = false,
  index = 0,
}: {
  bet: BetWithPositions;
  currentUserId: string;
  showGroup?: boolean;
  /** Position in the list, used to stagger the entrance. */
  index?: number;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const slices = betSlices(bet);
  const picked = myOptionId(bet, currentUserId);
  const countdown = bet.status === 'open' ? formatCountdown(bet.close_at) : null;
  const isResolved = bet.status === 'resolved';
  const isCancelled = bet.status === 'cancelled';
  const iWon = isResolved && picked !== null && picked === bet.winning_option_id;
  const media = bet.media ?? [];

  const myLabel = myOptionLabel(bet, currentUserId);
  const winner = winningLabel(bet);

  return (
    <Animated.View
      entering={
        reduced
          ? FadeIn.duration(motion.duration.fast)
          : FadeInDown.delay(Math.min(index, 6) * motion.stagger).duration(motion.duration.base)
      }
    >
      <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Bet: ${bet.title}`}
          style={elevation.card}
          className={`mb-3 overflow-hidden rounded-3xl border border-hairline-strong bg-surface ${
            isCancelled ? 'opacity-50' : ''
          }`}
        >
          {media.length > 0 && <BetMediaView media={media} className="h-40 w-full" />}

          <View className="p-5">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 flex-row items-center gap-1.5">
                {showGroup && bet.group ? (
                  <>
                    <GroupGlyph
                      emoji={bet.group.emoji}
                      avatarUrl={bet.group.avatar_url}
                      name={bet.group.name}
                      size={20}
                      radius={7}
                    />
                    <Text numberOfLines={1} className="flex-1 text-sm text-secondary">
                      {bet.group.name}
                    </Text>
                  </>
                ) : (
                  bet.status === 'open' && (
                    <>
                      <LiveDot />
                      <Text className="text-sm text-secondary">Live</Text>
                    </>
                  )
                )}
              </View>
              <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
            </View>

            <Text numberOfLines={3} className="mt-2 text-lg font-semibold text-primary">
              {bet.title}
            </Text>

            <View className="mt-2.5 flex-row items-center gap-4">
              <View className="flex-row items-baseline gap-1.5">
                <Money agorot={bet.total_pot_agorot} currency={bet.group?.currency} size="sm" tone="accent" />
                <Text className="text-sm text-secondary">pot</Text>
              </View>

              {countdown && (
                <View className="flex-row items-center gap-1.5">
                  <ClockIcon size={13} color={colors.textSecondary} />
                  <Text style={tabular} className="text-sm text-secondary">
                    {countdown.replace('Closes in ', '')}
                  </Text>
                </View>
              )}
            </View>

            <View className="mt-4">
              <OddsBar
                slices={slices}
                winningId={isResolved ? bet.winning_option_id ?? null : null}
                size="sm"
              />
            </View>
          </View>

          {picked && !isResolved && !isCancelled && (
            <View className="flex-row items-center gap-2 border-t border-hairline bg-accent-soft px-5 py-2.5">
              <Text className="text-sm text-accent">
                You&apos;re on <Text className="font-semibold">{myLabel}</Text>
              </Text>
            </View>
          )}

          {isResolved && picked && (
            <View
              className={`flex-row items-center justify-between gap-2 border-t border-hairline px-5 py-2.5 ${
                iWon ? 'bg-positive-soft' : 'bg-negative-soft'
              }`}
            >
              <Text className={`text-sm font-semibold ${iWon ? 'text-positive' : 'text-negative'}`}>
                {iWon ? 'You won' : 'You lost'}
              </Text>
              <Text className="text-sm text-secondary">{winner} took it</Text>
            </View>
          )}
        </PressableScale>
      </Link>
    </Animated.View>
  );
}
