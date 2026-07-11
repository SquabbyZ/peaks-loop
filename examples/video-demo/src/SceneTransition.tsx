import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig, Easing } from "remotion";

interface Props {
  /** Cross-fade duration in frames (overlap with the next/prev scene). */
  overlapFrames: number;
  /**
   * Direction the scene enters from. Pick a per-scene variant in Root.tsx
   * (or cycle them) for cinematic variety — not every transition is the
   * same wipe.
   */
  direction?: "from-right" | "from-left" | "zoom-in" | "zoom-out" | "wipe";
  children: React.ReactNode;
}

/**
 * SceneTransition — a cinematic cross-fade wrapper.
 *
 * Compared to TransitionFade (plain opacity cross-fade), this wrapper layers:
 *   - 0..overlap   : fade IN  + horizontal slide IN  + scale up  + brief blur out
 *   - mid          : steady
 *   - ..duration   : fade OUT + horizontal slide OUT + scale down + blur in
 *
 * Direction is the *enter* direction; the exit mirrors it (out-left for
 * from-right, etc.). Per-scene `direction` prop lets Root.tsx cycle
 * direction so consecutive scenes don't feel like the same wipe.
 *
 * Sequence durations are owned by Root.tsx; this wrapper does no frame
 * math of its own beyond reading `useCurrentFrame`.
 */
export const SceneTransition: React.FC<Props> = ({
  overlapFrames,
  direction = "from-right",
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, durationInFrames } = useVideoConfig();

  // Whether the scene is fading IN or OUT (or both ends when overlap > 0).
  const fadeInEnd = overlapFrames;
  const fadeOutStart = Math.max(0, durationInFrames - overlapFrames);

  const opacity = interpolate(
    frame,
    [0, fadeInEnd, fadeOutStart, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );

  // Slide IN — frame 0 → fadeInEnd maps from off-screen → 0.
  const slideIn = interpolate(frame, [0, fadeInEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const slideOut = interpolate(frame, [fadeOutStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });

  let slideX = 0;
  let scale = 1;
  let blur = 0;
  if (direction === "from-right") {
    slideX = (slideIn - slideOut) * width * 0.18;
  } else if (direction === "from-left") {
    slideX = -(slideIn - slideOut) * width * 0.18;
  } else if (direction === "zoom-in") {
    scale = 1 + (slideIn - slideOut) * 0.08;
  } else if (direction === "zoom-out") {
    scale = 1 - (slideIn - slideOut) * 0.06;
  } else if (direction === "wipe") {
    slideX = (slideIn - slideOut) * width * 0.06;
    blur = Math.max(slideIn, slideOut) * 6;
  }

  // Subtle blur during transition peaks (only on wipe).
  const blurPx = Math.max(0, blur);

  // Ripple ring — a faint cyan ring expands once at the transition peak.
  // The ring lives outside `children` (no pointer events) so it sits on top.
  const ringScale = interpolate(frame, [fadeInEnd * 0.5, fadeInEnd * 1.6], [0.6, 1.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const ringOpacity = interpolate(frame, [fadeInEnd * 0.5, fadeInEnd * 1.6], [0, 0.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Fade ring back out so it doesn't linger.
  const ringFadeOut = interpolate(
    frame,
    [fadeInEnd * 1.6, fadeInEnd * 2.2],
    [0.5, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{
          transform: `translate(${slideX}px, 0) scale(${scale})`,
          filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
      {/* Cyan ring overlay (fades out fast, only at scene entry) */}
      {ringFadeOut > 0 && (
        <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: 1200,
              height: 1200,
              borderRadius: 600,
              border: "1.5px solid rgba(165, 180, 252, 0.45)",
              transform: `scale(${ringScale})`,
              opacity: ringFadeOut,
              boxShadow: "0 0 60px rgba(99,102,241,0.4)",
            }}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};