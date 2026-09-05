import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS asks for reduced motion.
 *
 * Every entrance and spring in the app reads this. The skill's performance
 * section is explicit that accessibility is never traded for flair, and an app
 * whose whole personality is motion is exactly the kind that hurts people who
 * have that switch on.
 *
 * Motion is not removed, it is neutralised: elements still appear, they just
 * arrive without travel.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => setReduced(value)
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
