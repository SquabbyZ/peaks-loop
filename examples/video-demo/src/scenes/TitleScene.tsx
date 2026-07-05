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

  void fps;

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div
          className="font-sans text-brand-fg"
          style={{
            fontSize: 220,
            fontWeight: 800,
            letterSpacing: -8,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          peaks-code
        </div>
        <div
          className="font-mono text-brand-accent mt-8"
          style={{
            fontSize: 42,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
          }}
        >
          end-to-end loop engineering · PRD to QA to ship
        </div>
      </div>
    </AbsoluteFill>
  );
};
