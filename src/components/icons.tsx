import Svg, { Circle, Path, Rect, type SvgProps } from 'react-native-svg';

import { useColors } from '@/providers/theme-provider';

/**
 * A small hand-rolled icon set.
 *
 * Emoji were used at MVP to avoid an icon-font dependency, but they ignore
 * `color`, render differently on every platform, and read as a placeholder.
 * These are drawn on react-native-svg (already a dependency), so they inherit
 * colour and size, look identical everywhere, and stay crisp at any scale.
 *
 * All icons are on a 24×24 grid with a 1.75 stroke, rounded caps and joins.
 */

export interface IconProps extends Omit<SvgProps, 'color'> {
  size?: number;
  color?: string;
  /** Filled variant, used for the active tab. */
  active?: boolean;
}

function Icon({
  size = 24,
  color,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  const palette = useColors();
  const stroke = color ?? palette.textSecondary;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </Svg>
  );
}

export function HomeIcon({ active, ...props }: IconProps) {
  return (
    <Icon {...props}>
      <Path
        d="M3.5 10.2 12 3.6l8.5 6.6V19a1.6 1.6 0 0 1-1.6 1.6H5.1A1.6 1.6 0 0 1 3.5 19z"
        fill={active ? (props.color ?? undefined) : 'none'}
        fillOpacity={active ? 0.18 : 0}
      />
      <Path d="M9.4 20.6v-6.2h5.2v6.2" />
    </Icon>
  );
}

export function GroupsIcon({ active, ...props }: IconProps) {
  return (
    <Icon {...props}>
      <Circle
        cx={9}
        cy={8.2}
        r={3.4}
        fill={active ? (props.color ?? undefined) : 'none'}
        fillOpacity={active ? 0.18 : 0}
      />
      <Path d="M2.9 20.1a6.1 6.1 0 0 1 12.2 0" />
      <Path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.5" />
      <Path d="M17.9 14.6a6.1 6.1 0 0 1 3.2 5.5" />
    </Icon>
  );
}

export function ProfileIcon({ active, ...props }: IconProps) {
  return (
    <Icon {...props}>
      <Circle
        cx={12}
        cy={8}
        r={3.8}
        fill={active ? (props.color ?? undefined) : 'none'}
        fillOpacity={active ? 0.18 : 0}
      />
      <Path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M9 5.5 15.5 12 9 18.5" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M15 5.5 8.5 12 15 18.5" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Circle cx={12} cy={12} r={8.4} />
      <Path d="M12 7.3V12l3.1 1.9" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M6.4 10.6h11.2a1.4 1.4 0 0 1 1.4 1.4v7a1.4 1.4 0 0 1-1.4 1.4H6.4A1.4 1.4 0 0 1 5 19v-7a1.4 1.4 0 0 1 1.4-1.4Z" />
      <Path d="M8.4 10.6V7.9a3.6 3.6 0 0 1 7.2 0v2.7" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M4.8 12.6 9.6 17.4 19.2 6.6" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M9.4 9.4h8.4a1.4 1.4 0 0 1 1.4 1.4v8.4a1.4 1.4 0 0 1-1.4 1.4H9.4A1.4 1.4 0 0 1 8 19.2v-8.4a1.4 1.4 0 0 1 1.4-1.4Z" />
      <Path d="M5.5 15.2A1.4 1.4 0 0 1 4.8 14V5.6a1.4 1.4 0 0 1 1.4-1.4h8.4a1.4 1.4 0 0 1 1.2.7" />
    </Icon>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M7.6 4.4h8.8v5a4.4 4.4 0 1 1-8.8 0z" />
      <Path d="M7.6 6.2H5.2a2.4 2.4 0 0 0 2.4 4" />
      <Path d="M16.4 6.2h2.4a2.4 2.4 0 0 1-2.4 4" />
      <Path d="M12 13.8v3.4M8.6 20.2h6.8l-.8-3h-5.2z" />
    </Icon>
  );
}

export function HandshakeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M3.4 9.6 7 6.4l3.6 2.2 3.4-2.2 3.6 3.2" />
      <Path d="M10.6 8.6 8 11.4a1.7 1.7 0 0 0 2.4 2.4l.8-.8 1.6 1.6a1.7 1.7 0 0 0 2.4-2.4" />
      <Path d="M14 12.6l2 2a1.7 1.7 0 0 0 2.4-2.4l-1.8-1.8" />
      <Path d="M3.4 9.6v4.2M20.6 9.6v4.2" />
    </Icon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M12 3.4 13.9 9l5.6 1.9-5.6 1.9L12 18.4 10.1 12.8 4.5 10.9 10.1 9z" />
      <Path d="M18.6 3.6v2.8M20 5h-2.8" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Circle cx={12} cy={12} r={8.4} />
      <Path d="M12 7.8v4.8M12 16.1h.01" />
    </Icon>
  );
}

export function TicketIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M4 8.2a1.4 1.4 0 0 1 1.4-1.4h13.2A1.4 1.4 0 0 1 20 8.2v2a2.1 2.1 0 0 0 0 3.6v2a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 15.8v-2a2.1 2.1 0 0 0 0-3.6z" />
      <Path d="M13.4 6.8v10.4" strokeDasharray="1.6 2" />
    </Icon>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M9.6 20.2H5.8a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6h3.8" />
      <Path d="M15.4 16.2 19.8 12l-4.4-4.2M19.8 12H9.2" />
    </Icon>
  );
}

export function PhotoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Rect x={3} y={4.5} width={18} height={15} rx={3.5} />
      <Circle cx={8.6} cy={9.6} r={1.5} />
      <Path d="M3.4 16.2 8 12.1a2 2 0 0 1 2.7.05l3.1 3a2 2 0 0 0 2.7.05l1.5-1.3a2 2 0 0 1 2.6 0l1 .85" />
    </Icon>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Rect x={2.6} y={5.5} width={13.2} height={13} rx={3.4} />
      <Path d="m15.8 11 4-2.6a.9.9 0 0 1 1.4.75v5.7a.9.9 0 0 1-1.4.75l-4-2.6z" />
    </Icon>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M3 8.8A2.3 2.3 0 0 1 5.3 6.5h1.4a2 2 0 0 0 1.7-1l.5-.8a1.6 1.6 0 0 1 1.35-.75h3.5A1.6 1.6 0 0 1 15.1 4.7l.5.8a2 2 0 0 0 1.7 1h1.4A2.3 2.3 0 0 1 21 8.8v7.9a2.3 2.3 0 0 1-2.3 2.3H5.3A2.3 2.3 0 0 1 3 16.7z" />
      <Circle cx={12} cy={12.4} r={3.4} />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path
        d="M8.4 5.6 18.2 11.4a.7.7 0 0 1 0 1.2L8.4 18.4a.7.7 0 0 1-1.05-.6V6.2a.7.7 0 0 1 1.05-.6z"
        fill={props.color ?? undefined}
      />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4" />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Rect x={3} y={5.2} width={18} height={13.6} rx={3.4} />
      <Path d="m4.2 8.4 6.6 4.6a2 2 0 0 0 2.4 0l6.6-4.6" />
    </Icon>
  );
}

export function EyeIcon({ active, ...props }: IconProps) {
  return (
    <Icon {...props}>
      {active ? (
        <>
          <Path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12z" />
          <Path d="m5 5 14 14" />
        </>
      ) : (
        <>
          <Path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12z" />
          <Circle cx={12} cy={12} r={2.9} />
        </>
      )}
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Path d="M18 9.4a6 6 0 1 0-12 0c0 4.4-1.6 5.8-1.6 5.8h15.2S18 13.8 18 9.4z" />
      <Path d="M13.7 18.6a2 2 0 0 1-3.4 0" />
    </Icon>
  );
}

export function ContrastIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <Circle cx={12} cy={12} r={8.4} />
      <Path d="M12 3.6v16.8a8.4 8.4 0 0 0 0-16.8z" fill={props.color ?? undefined} />
    </Icon>
  );
}
