import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import type { LocaleId } from "../copy";
import { COPY } from "../copy";
import { BrandBackground } from "./BrandBackground";

interface Props {
  locale: LocaleId;
}

/**
 * IntroScene — hero brand title + tagline.
 * Replaces the old TitleScene with a slightly more cinematic feel
 * (title lifts + tagline settles, both gated by stagger).
 */
export const IntroScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const c = COPY[locale].intro;

  const titleOpacity = interpolate(frame, [0, 14, durationInFrames - 14, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 28], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const titleTracking = interpolate(frame, [0, 28], [-2, -4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const taglineOpacity = interpolate(frame, [12, 30, durationInFrames - 14, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [12, 36], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const kickerOpacity = interpolate(frame, [4, 22, durationInFrames - 14, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const kickerX = interpolate(frame, [0, 22], [-30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      <BrandBackground withHalo accentColor="#6366f1" />
      <div className="flex flex-col items-center">
        <div
          className="font-mono text-brand-accent"
          style={{
            fontSize: 32,
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
          {c.title}
        </div>
        <div
          className="font-mono text-brand-accent mt-10"
          style={{
            fontSize: 36,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            letterSpacing: 1,
            textAlign: "center",
            lineHeight: 1.3,
            maxWidth: 1400,
          }}
        >
          <div>{c.taglineLineA}</div>
          <div style={{ fontSize: 24, color: "#94a3b8", marginTop: 12 }}>
            {c.taglineSep} {c.taglineLineB}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};