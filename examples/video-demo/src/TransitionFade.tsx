import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig, Easing } from "remotion";

interface Props {
  overlapFrames: number;
  children: React.ReactNode;
}

/**
 * Cross-fade wrapper. Lives inside a `<Series.Sequence>` which clips the
 * timeline; here we operate on RELATIVE frames only. Each scene's
 * `Series.Sequence` is `bodyLength + overlapFrames` wide so the wrapper
 * has the extra 2×overlap at each end without ever leaking beyond the
 * Sequence window.
 *
 * Sequence durations are entirely owned by `Root.tsx`. This wrapper does
 * no frame-window math on its own.
 */
export const TransitionFade: React.FC<Props> = ({ overlapFrames, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeInEnd = overlapFrames;
  const fadeOutStart = Math.max(0, durationInFrames - overlapFrames);

  const opacity = interpolate(
    frame,
    [0, fadeInEnd, fadeOutStart, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );

  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
