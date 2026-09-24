import { Link, useRouter } from 'expo-router';
import { memo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from '@/components/animated';

import { BetActions, betSocial } from '@/components/bet-actions';
import { BetMediaView } from '@/components/bet-media';
import { GroupFace } from '@/components/group-face';
import { GroupGlyph } from '@/components/group-glyph';
import { ClockIcon, LockIcon } from '@/components/icons';
import { OddsBar, type OddsSlice } from '@/components/odds-bar';
import { Avatar, Badge, LiveDot, Money, PressableScale, tap } from '@/components/ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { shareBet } from '@/lib/invites';
import type { FeedComment } from '@/lib/queries';
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
  comments = [],
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
  /**
   * The last words on this bet, oldest first.
   *
   * Passed in rather than fetched: the feed reads them for the whole page in
   * one query, because PostgREST cannot limit an embed per parent and a
   * hundred bets would otherwise come back with every comment on all of them.
   */
  comments?: FeedComment[];
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

  return (
    <View style={{ height }} className="px-3">
      {/*
        The card is an object on the page, not a full-bleed photograph.
        Everything below is measured against the approved board: 28pt corners
        on a hairline over `surface`, the media a 162pt panel inset 10 from the
        card's own edges, and one 3pt rule under the two figures.
      */}
      <View className="overflow-hidden rounded-4xl border border-hairline bg-surface">
        <View className="flex-row items-center gap-2.5 px-4 pt-[15px]">
          {bet.group && (
            <>
              {/* The group's photo, or its initials in its own derived colour.
                  `GroupFace` falls back to a stack of member avatars, and the
                  feed deliberately does not embed members (it reads a hundred
                  bets), so here the fallback would be an empty grey disc that
                  reads as something still loading. An emoji was the older
                  guess and rendered differently on every platform. */}
              {bet.group.avatar_url ? (
                <GroupFace avatarUrl={bet.group.avatar_url} members={[]} size={30} radius={999} />
              ) : (
                <Avatar id={bet.group.id} name={bet.group.name} size={30} />
              )}
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-[14px] font-semibold text-primary">
                  {bet.group.name}
                </Text>
                {bet.creator && (
                  <Text numberOfLines={1} className="mt-px text-[11px] text-secondary">
                    {bet.creator.username
                      ? `@${bet.creator.username}`
                      : bet.creator.display_name}
                  </Text>
                )}
              </View>
            </>
          )}
          {/* "New" displaces "Live": both say the bet is open, and two pills
              in a corner is clutter. */}
          {isNew && bet.status === 'open' ? (
            <View className="rounded-full bg-accent px-2.5 py-1">
              <Text className="text-xs font-semibold text-accent-ink">New</Text>
            </View>
          ) : bet.status === 'open' ? (
            <View className="flex-row items-center gap-1.5 rounded-full bg-surface3 px-2.5 py-1">
              <LiveDot />
              <Text className="text-xs font-semibold text-primary">Live</Text>
            </View>
          ) : (
            <Badge label={bet.status} tone={STATUS_TONE[bet.status]} />
          )}
        </View>

        {hasMedia && (
          <View className="mx-2.5 mt-[13px] h-[162px] overflow-hidden rounded-[18px]">
            <BetMediaView media={media} active={active} className="absolute inset-0" />
          </View>
        )}

        {/* The side buttons sit *outside* the Link. Nesting a button in a link
            is invalid markup, and on the web the inner press fires and then
            the browser's own anchor activation navigates the document. */}
        <View className="px-4 pb-2 pt-4">
          <Link href={{ pathname: '/bet/[id]', params: { id: bet.id } }} asChild>
            <PressableScale
              scaleTo={0.995}
              accessibilityRole="button"
              accessibilityLabel={`Bet: ${bet.title}`}
            >
              <Text
                // Without a photo the question is the whole post, so it takes
                // the lines the picture would have had.
                numberOfLines={hasMedia ? 2 : 5}
                className={`font-bold tracking-[-0.6px] text-primary ${
                  hasMedia ? 'text-[23px] leading-[27px]' : 'text-[28px] leading-[34px]'
                }`}
              >
                {bet.title}
              </Text>

              <View className="mt-2.5 flex-row items-center gap-[14px]">
                {/* The figure alone: an amount on a bet card is the pot and
                    nothing else — and neutral, not green. `positive` and
                    `negative` mean money owed to you and money you owe; a pot
                    is neither, and colouring it would give the ledger's one
                    convention a third meaning on the busiest screen. */}
                <Money
                  agorot={bet.total_pot_agorot}
                  currency={bet.group?.currency}
                  size="pot"
                  tone="neutral"
                />

                {countdown && (
                  <View className="flex-row items-center gap-1.5">
                    <ClockIcon size={14} color={colors.textSecondary} />
                    <Text style={tabular} className="text-sm text-secondary">
                      {countdown.replace('Closes in ', '')}
                    </Text>
                  </View>
                )}

                {bet.status === 'locked' && (
                  <View className="flex-row items-center gap-1.5">
                    <LockIcon size={14} color={colors.textSecondary} />
                    <Text className="text-sm text-secondary">Locked</Text>
                  </View>
                )}
              </View>

              <View className="mt-[18px]">
                {/* No names: they are on the buttons directly below, in their
                    own colour and on the thing you press. */}
                <OddsBar
                  slices={slices}
                  compact
                  showNames={false}
                  figurePx={30}
                  barPx={3}
                  gapPx={12}
                />
              </View>
            </PressableScale>
          </Link>

          {joinable && (
            <View className="mt-[18px] flex-row flex-wrap gap-2.5">
              {slices.map((slice, index) => (
                <OptionPick
                  key={slice.id}
                  label={slice.label}
                  index={index}
                  count={slices.length}
                  selected={picked === slice.id}
                  busy={busyOptionId === slice.id}
                  onPress={() => {
                    tap();
                    onPickOption?.(slice.id);
                  }}
                />
              ))}
            </View>
          )}

          {onToggleLike && (
            <View className="mt-1">
              <BetActions
                liked={social.liked}
                likeCount={social.likeCount}
                commentCount={social.commentCount}
                onToggleLike={onToggleLike}
                onPressComments={openThread}
                onPressShare={() => {
                  tap();
                  // Swallowed on purpose: a share sheet the user dismissed is
                  // not an error worth interrupting the feed for.
                  void shareBet(bet.id, bet.title, bet.group?.name).catch(() => {});
                }}
              />
            </View>
          )}
        </View>

        {/* The social footer: what just happened, and the last two things
            anybody said. It sits on `surface2` behind a hairline so the card
            reads as two zones — the bet, and the talk about it. */}
        <FeedSocial
          bet={bet}
          comments={comments}
          commentCount={social.commentCount}
          onOpen={openThread}
        />
      </View>
    </View>
  );
}

/**
 * The strip at the foot of a feed card.
 *
 * The activity line is derived from the bet's own positions — the newest one,
 * who made it and when — rather than from an events table the schema does not
 * have. The comments come from one extra read for the whole page rather than
 * an embed per bet, which is why `comments` arrives as a prop instead of being
 * fetched here.
 *
 * Both halves are optional and the strip disappears entirely when there is
 * neither, so a brand-new bet does not carry an empty grey band.
 */
function FeedSocial({
  bet,
  comments,
  commentCount,
  onOpen,
}: {
  bet: BetWithPositions;
  comments: FeedComment[];
  commentCount: number;
  onOpen: () => void;
}) {
  const latest = (bet.positions ?? [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  // No name, no line. Realtime hands over a row without its embeds, so a
  // just-arrived position has a timestamp and nobody attached to it, and
  // "Someone picked a side" is worse than silence.
  const actor = latest?.user?.display_name ?? null;
  const actorAt = latest?.created_at ?? null;
  const shown = comments.slice(-2);

  if (!(actor && actorAt) && shown.length === 0) return null;

  return (
    <View className="border-t border-hairline bg-surface2 px-4 pb-1 pt-3">
      {actor && actorAt && (
        <View className="flex-row items-center gap-[9px]">
          <View className="mx-2 h-1.5 w-1.5 rounded-full bg-brand" />
          <Text numberOfLines={1} className="flex-1 text-sm text-secondary">
            <Text className="font-semibold text-primary">{actor}</Text> picked a side
          </Text>
          <Text className="text-xs text-secondary">{actorAt ? shortAgo(actorAt) : ''}</Text>
        </View>
      )}

      {shown.length > 0 && (
        <View className="mt-3 gap-[11px]">
          {shown.map((comment) => (
            <View key={comment.id} className="flex-row items-start gap-[9px]">
              <Avatar
                id={comment.user_id}
                name={comment.author?.display_name ?? '?'}
                uri={comment.author?.avatar_url}
                size={22}
              />
              {/* Name and body in one flowing paragraph: it reads the way a
                  spoken remark reads and costs a line less per comment. */}
              <Text numberOfLines={2} className="flex-1 text-sm leading-[19px] text-primary">
                <Text className="font-semibold">
                  {comment.author?.display_name ?? 'Someone'}
                </Text>{' '}
                {comment.body}
                <Text className="text-xs text-secondary"> {shortAgo(comment.created_at)}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}

      {commentCount > 0 && (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`View all ${commentCount} comments`}
          onPress={onOpen}
          className="min-h-11 justify-center"
        >
          <Text className="text-sm text-secondary">
            View all {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

/** "4m", "2h", "3d" — the feed's own shorthand, narrower than a countdown. */
function shortAgo(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
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
  onMedia = false,
  busy,
  onPress,
}: {
  label: string;
  index: number;
  count: number;
  selected: boolean;
  onMedia?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const scheme = useScheme();
  const color = optionColor(index, count, scheme, onMedia);
  // The first side is filled and the rest are outlined on their own soft
  // ground. It is not a selected state — it is the shape the board draws,
  // and it gives the row a weight on the side the question is phrased from.
  const filled = index === 0;
  const ink = scheme === 'dark' ? '#00190C' : '#FFFFFF';

  return (
    <PressableScale
      scaleTo={0.96}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected, busy }}
      accessibilityLabel={selected ? `Withdraw from ${label}` : `Back ${label}`}
      style={{
        backgroundColor: filled ? color : undefined,
        borderColor: color,
        borderWidth: selected ? 2 : filled ? 0 : 1,
        flexBasis: count === 2 ? 0 : '47%',
        flexGrow: 1,
      }}
      className={`h-12 items-center justify-center rounded-[14px] px-3 ${
        filled ? '' : index === 1 ? 'bg-sideB-soft' : 'bg-surface2'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <Text
        numberOfLines={1}
        style={{ color: filled ? ink : color }}
        className={`text-callout ${filled ? 'font-bold' : 'font-semibold'}`}
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
