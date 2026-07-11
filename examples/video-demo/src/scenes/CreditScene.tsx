import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import type { LocaleId } from "../copy";
import { COPY } from "../copy";
import { BrandBackground } from "./BrandBackground";

interface Props {
  locale: LocaleId;
}

/**
 * CreditScene — tribute to upstream projects + recommended stack.
 * Tighter than v4: bigger tribute names, smaller stack list, all set
 * against the same BrandBackground the rest of the demo uses.
 */
export const CreditScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const c = COPY[locale].credit;
  const localT = frame;
  const localDuration = durationInFrames;

  const enter = (delay: number) => {
    const opacity = interpolate(localT, [delay, delay + 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const slide = interpolate(localT, [delay, delay + 14], [24, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    return { opacity, slide };
  };

  const titleE = enter(0);
  const stackE = enter(28);
  const footerE = interpolate(localT, [50, 64, localDuration - 12, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      <BrandBackground withHalo accentColor="#a78bfa" />

      <div
        className="flex flex-col items-center"
        style={{
          width: Math.round(width * 0.86),
          opacity: titleE.opacity,
          transform: `translateY(${titleE.slide}px)`,
        }}
      >
        <div
          className="font-mono text-brand-accent"
          style={{ fontSize: 28, letterSpacing: 6, textTransform: "uppercase", marginBottom: 18 }}
        >
          {c.kicker}
        </div>

        <div
          className="font-sans text-brand-fg"
          style={{
            fontSize: 80,
            fontWeight: 800,
            letterSpacing: -2,
            textAlign: "center",
            lineHeight: 1.1,
            marginBottom: 12,
          }}
        >
          {c.headlineLineA}
        </div>
        <div
          className="font-mono"
          style={{ fontSize: 26, color: "#94a3b8", marginBottom: 36 }}
        >
          {c.headlineSep} {c.headlineLineB}
        </div>

        <div
          className="font-mono"
          style={{
            fontSize: 18,
            letterSpacing: 4,
            color: "#6366f1",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          {c.tributeLabel}
        </div>
        <div
          className="font-mono"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "center",
            marginBottom: 36,
          }}
        >
          {c.tributeItems.map((it, i) => (
            <div
              key={i}
              style={{ fontSize: 26, color: "#cbd5e1", letterSpacing: 0.5 }}
            >
              <span style={{ color: "#f8fafc", fontWeight: 700 }}>{it.name}</span>
              <span style={{ color: "#94a3b8" }}>  {it.handle}</span>
              <span style={{ color: "#22c55e", marginLeft: 10 }}>· {it.role}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.72),
          left: 0,
          right: 0,
          opacity: stackE.opacity,
          transform: `translateY(${stackE.slide}px)`,
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: 18,
            letterSpacing: 4,
            color: "#22c55e",
            textTransform: "uppercase",
            textAlign: "center",
            marginBottom: 14,
          }}
        >
          {c.stackLabel}
        </div>
        <div
          className="font-mono"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 36,
            flexWrap: "wrap",
            paddingLeft: 40,
            paddingRight: 40,
          }}
        >
          {c.stackItems.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 24, color: "#f8fafc", fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 16, color: "#94a3b8" }}>{s.tagline}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="font-mono"
        style={{
          position: "absolute",
          bottom: Math.round(height * 0.06),
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 22,
          color: "#94a3b8",
          letterSpacing: 1,
          opacity: footerE,
        }}
      >
        {c.footerLineA}
        <span style={{ color: "#6366f1", margin: "0 12px" }}>{c.footerSep}</span>
        <span style={{ color: "#f8fafc" }}>{c.footerLineB}</span>
      </div>
    </AbsoluteFill>
  );
};