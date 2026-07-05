import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

interface Props {
  from: number;
  to: number;
}

export const TitleScene: React.FC<Props> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = frame;
  const inRange = localFrame >= from && localFrame < to;
  if (!inRange) {
    return null;
  }

  const localT = localFrame - from;
  const localDuration = to - from;

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

  // Loop-engineering accent kicker
  const kickerOpacity = interpolate(localT, [4, 20, localDuration - 15, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  void fps;

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div
          className="font-mono text-brand-accent"
          style={{
            fontSize: 36,
            letterSpacing: 6,
            textTransform: "uppercase",
            opacity: kickerOpacity,
            marginBottom: 28,
          }}
        >
          ★ loop engineering · in production
        </div>
        <div
          className="font-sans text-brand-fg"
          style={{
            fontSize: 240,
            fontWeight: 800,
            letterSpacing: -10,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            lineHeight: 1,
          }}
        >
          peaks-loop
        </div>
        <div
          className="font-mono text-brand-accent mt-10"
          style={{
            fontSize: 40,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            letterSpacing: 1,
          }}
        >
          your AI 战术小队, 24 hours on call — one sentence, one flow
        </div>
      </div>
    </AbsoluteFill>
  );
};
