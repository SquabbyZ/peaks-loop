import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig, Easing } from "remotion";
import { COPY, type LocaleId } from "../copy";

interface Props {
  locale: LocaleId;
}

export const TitleScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const localT = frame;
  const localDuration = durationInFrames;
  const c = COPY[locale].title;

  const titleOpacity = interpolate(localT, [0, 15, localDuration - 15, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(localT, [0, 30], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const taglineOpacity = interpolate(localT, [10, 30, localDuration - 15, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(localT, [10, 40], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Kicker enters fastest, locks in for the body, fades out last.
  const kickerOpacity = interpolate(localT, [4, 20, localDuration - 15, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // === Cool effects ===
  // Subtle indigo halo behind the title that pulses on entry.
  const haloScale = interpolate(localT, [0, 30], [0.4, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const haloOpacity = interpolate(localT, [0, 18, localDuration - 30, localDuration - 12], [0, 0.35, 0.35, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Title letter-spacing tightens as it settles in.
  const titleTracking = interpolate(localT, [0, 30], [-2, -4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  // Kicker drifts in from the left with a small horizontal slide.
  const kickerX = interpolate(localT, [0, 20], [-30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      {/* Indigo halo behind the title. */}
      <div
        style={{
          position: "absolute",
          width: 1200,
          height: 1200,
          left: "50%",
          top: "50%",
          marginLeft: -600,
          marginTop: -600,
          background:
            "radial-gradient(circle, rgba(99,102,241,0.55) 0%, rgba(99,102,241,0) 65%)",
          transform: `scale(${haloScale})`,
          opacity: haloOpacity,
          pointerEvents: "none",
        }}
      />
      <div className="flex flex-col items-center">
        <div
          className="font-mono text-brand-accent"
          style={{
            fontSize: 36,
            letterSpacing: 6,
            textTransform: "uppercase",
            opacity: kickerOpacity,
            marginBottom: 28,
            transform: `translateX(${kickerX}px)`,
          }}
        >
          {c.kicker}
        </div>
        <div
          className="font-sans text-brand-fg"
          style={{
            fontSize: 180,
            fontWeight: 800,
            letterSpacing: titleTracking,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            lineHeight: 1,
            textShadow: `0 0 ${40 * titleOpacity}px rgba(99,102,241,${0.45 * titleOpacity})`,
          }}
        >
          peaks-loop
        </div>
        {/* Locked-separator tagline: line A (primary), then sep, then line B (subline). */}
        <div
          className="font-mono text-brand-accent mt-10"
          style={{
            fontSize: 38,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            letterSpacing: 1,
            textAlign: "center",
            lineHeight: 1.25,
          }}
        >
          <div>{c.taglineLineA}</div>
          <div style={{ fontSize: 26, color: "#94a3b8", marginTop: 12 }}>
            {c.taglineSep} {c.taglineLineB}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
