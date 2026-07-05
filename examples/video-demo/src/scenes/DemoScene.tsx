import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig, Easing } from "remotion";

export type DemoSteps = string[];

interface Props {
  from: number;
  to: number;
  title: string;
  subtitle: string;
  steps: DemoSteps;
  sceneIndex: number;
}

export const DemoScene: React.FC<Props> = ({ from, to, title, subtitle, steps, sceneIndex }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  if (frame < from || frame >= to) {
    return null;
  }

  const localT = frame - from;
  const localDuration = to - from;

  const titleOpacity = interpolate(localT, [0, 20, localDuration - 20, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const stepCount = steps.length;
  const perStep = (localDuration - 60) / stepCount;
  const stepStartY = Math.round(height * 0.45);
  const stepX = Math.round(width * 0.08);
  const stepGap = Math.round((width - stepX * 2 - 220) / Math.max(1, stepCount - 1));

  return (
    <AbsoluteFill className="bg-brand-bg">
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.16),
          left: stepX,
          right: stepX,
          opacity: titleOpacity,
        }}
      >
        <div
          className="font-sans text-brand-fg"
          style={{ fontSize: 120, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 }}
        >
          {title}
        </div>
        <div
          className="font-mono text-brand-accent mt-6"
          style={{ fontSize: 34, letterSpacing: 1 }}
        >
          {subtitle}
        </div>
        <div
          className="font-mono mt-6"
          style={{ fontSize: 22, color: "#94a3b8" }}
        >
          slice #{sceneIndex + 1} · {stepCount} gates
        </div>
      </div>

      {steps.map((step, idx) => {
        const stepStart = 30 + idx * perStep;
        const stepEnd = stepStart + perStep + 30;
        const stepOpacity = interpolate(localT, [stepStart, stepStart + 15, stepEnd, stepEnd + 15], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const slideY = interpolate(localT, [stepStart, stepStart + 20], [40, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });

        return (
          <div
            key={`${sceneIndex}-${idx}-${step}`}
            style={{
              position: "absolute",
              top: stepStartY,
              left: stepX + idx * stepGap,
              opacity: stepOpacity,
              transform: `translateY(${slideY}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: 220,
            }}
          >
            <div
              className="font-mono text-brand-accent"
              style={{
                fontSize: 24,
                width: 56,
                height: 56,
                borderRadius: 28,
                background: "#1e293b",
                border: "2px solid #6366f1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              {idx + 1}
            </div>
            <div
              className="font-mono text-brand-fg text-center"
              style={{ fontSize: 28, lineHeight: 1.2 }}
            >
              {step}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
