import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig, Easing } from "remotion";
import type { LocaleId } from "../copy";

export type DemoSteps = string[];

interface Props {
  locale: LocaleId;
  title: string;
  subtitle: string;
  steps: DemoSteps;
  sceneIndex: number;
}

export const DemoScene: React.FC<Props> = ({ locale: _locale, title, subtitle, steps, sceneIndex }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const localT = frame;
  const localDuration = durationInFrames;

  const titleOpacity = interpolate(localT, [0, 20, localDuration - 20, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(localT, [0, 24], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const stepCount = steps.length;
  const perStep = (localDuration - 60) / stepCount;
  const stepStartY = Math.round(height * 0.45);
  const stepX = Math.round(width * 0.08);
  const stepGap = Math.round((width - stepX * 2 - 220) / Math.max(1, stepCount - 1));

  // === Cool effects ===
  // "Connector line" — a horizontal line under the badges that draws
  // itself from left to right as steps appear.
  const connectorProgress = interpolate(
    localT,
    [30, 30 + stepCount * perStep],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  return (
    <AbsoluteFill className="bg-brand-bg">
      {/* Faint indigo halo behind the title. */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 500,
          left: stepX,
          top: Math.round(height * 0.08),
          background:
            "radial-gradient(circle, rgba(99,102,241,0.30) 0%, rgba(99,102,241,0) 70%)",
          opacity: titleOpacity,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.16),
          left: stepX,
          right: stepX,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
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
          style={{ fontSize: 32, letterSpacing: 1 }}
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

      {/* Horizontal connector line that "draws" as steps appear. */}
      <div
        style={{
          position: "absolute",
          top: stepStartY + 28,
          left: stepX + 28,
          width: Math.max(0, stepGap * (stepCount - 1) * connectorProgress),
          height: 2,
          background: "rgba(99,102,241,0.6)",
          boxShadow: "0 0 8px rgba(99,102,241,0.6)",
          pointerEvents: "none",
        }}
      />

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
        const badgeScale = interpolate(localT, [stepStart, stepStart + 12], [0.5, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.back(1.4)),
        });

        return (
          <div
            key={`${sceneIndex}-${idx}-${step}`}
            style={{
              position: "absolute",
              top: stepStartY,
              left: stepX + idx * stepGap,
              opacity: stepOpacity,
              transform: `translateY(${slideY}px) scale(${badgeScale})`,
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
                boxShadow: "0 0 18px rgba(99,102,241,0.5)",
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
