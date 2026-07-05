import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from "remotion";

interface Props {
  from: number;
  to: number;
}

export const ClosingScene: React.FC<Props> = ({ from, to }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) {
    return null;
  }

  const localT = frame - from;
  const localDuration = to - from;

  const ctaOpacity = interpolate(localT, [0, 20, localDuration - 20, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaY = interpolate(localT, [0, 30], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const secondOpacity = interpolate(localT, [15, 40, localDuration - 20, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div
          className="font-mono text-brand-accent"
          style={{
            fontSize: 56,
            opacity: ctaOpacity,
            transform: `translateY(${ctaY}px)`,
            background: "#1e293b",
            padding: "20px 40px",
            borderRadius: 16,
            border: "2px solid #6366f1",
          }}
        >
          npx peaks-loop install
        </div>
        <div
          className="font-sans text-brand-fg mt-12"
          style={{
            fontSize: 88,
            fontWeight: 800,
            opacity: ctaOpacity,
            letterSpacing: -2,
          }}
        >
          ship the loop, not the ticket
        </div>
        <div
          className="font-mono mt-10"
          style={{
            fontSize: 36,
            color: "#94a3b8",
            opacity: secondOpacity,
          }}
        >
          github.com/peaks-loop/peaks-loop
        </div>
      </div>
    </AbsoluteFill>
  );
};
