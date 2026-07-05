import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { COPY, type LocaleId } from "../copy";

interface Props {
  locale: LocaleId;
}

export const ClosingScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const localT = frame;
  const localDuration = durationInFrames;
  const c = COPY[locale].closing;

  const chipOpacity = interpolate(localT, [0, 14, localDuration - 14, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const chipY = interpolate(localT, [0, 14], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const repoOpacity = interpolate(localT, [16, 30, localDuration - 14, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const skillOpacity = interpolate(localT, [34, 48, localDuration - 14, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const footerOpacity = interpolate(localT, [52, 70, localDuration - 14, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // === Cool effects ===
  // Sweep line behind the install chip (animated diagonal scanline).
  const sweepX = interpolate(localT, [0, localDuration], [-300, width + 300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Slow rotation on the repo arrow.
  const arrowRot = interpolate(localT, [16, 30], [-12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
      {/* Indigo halo, slightly softer than Title. */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          left: "50%",
          top: "50%",
          marginLeft: -450,
          marginTop: -450,
          background:
            "radial-gradient(circle, rgba(99,102,241,0.30) 0%, rgba(99,102,241,0) 70%)",
          opacity: chipOpacity,
          pointerEvents: "none",
        }}
      />
      {/* Animated sweep line. */}
      <div
        style={{
          position: "absolute",
          left: sweepX,
          top: 0,
          width: 180,
          height: "100%",
          background:
            "linear-gradient(90deg, rgba(99,102,241,0) 0%, rgba(99,102,241,0.18) 50%, rgba(99,102,241,0) 100%)",
          transform: "skewX(-12deg)",
          pointerEvents: "none",
        }}
      />
      <div className="flex flex-col items-center" style={{ width: Math.round(width * 0.86) }}>
        {/* Install chip */}
        <div
          className="font-mono"
          style={{
            fontSize: 56,
            color: "#f8fafc",
            background: "#1e293b",
            padding: "18px 36px",
            borderRadius: 14,
            border: "2px solid #6366f1",
            opacity: chipOpacity,
            transform: `translateY(${chipY}px)`,
            marginBottom: 56,
            boxShadow: "0 0 32px rgba(99,102,241,0.45)",
          }}
        >
          {c.chip}
        </div>

        {/* Row A — REPO NAME */}
        <div
          className="font-mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            opacity: repoOpacity,
            marginBottom: 28,
          }}
        >
          <span style={{ fontSize: 24, color: "#94a3b8", textDecoration: "line-through" }}>
            {c.repoArc.repoWas}{" "}
            <span style={{ fontStyle: "italic", opacity: 0.7 }}>({c.repoArc.wasLabel})</span>
          </span>
          <span
            style={{
              fontSize: 32,
              color: "#6366f1",
              display: "inline-block",
              transform: `rotate(${arrowRot}deg)`,
            }}
          >
            {c.repoArc.arrow}
          </span>
          <span style={{ fontSize: 40, fontWeight: 800, color: "#f8fafc" }}>
            {c.repoArc.repoNow}
          </span>
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: 16,
            color: "#94a3b8",
            letterSpacing: 3,
            textTransform: "uppercase",
            opacity: repoOpacity,
            marginBottom: 44,
          }}
        >
          {c.repoArc.caption}
        </div>

        {/* Row B — SKILL NAME */}
        <div
          className="font-mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            opacity: skillOpacity,
            marginBottom: 28,
          }}
        >
          <span style={{ fontSize: 28, color: "#94a3b8" }}>{c.skillArc.skillWas}</span>
          <span style={{ fontSize: 32, color: "#6366f1" }}>{c.skillArc.arrow}</span>
          <span style={{ fontSize: 36, fontWeight: 800, color: "#f8fafc" }}>
            {c.skillArc.skillNow}
          </span>
        </div>
        <div
          className="font-mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontSize: 16,
            color: "#94a3b8",
            letterSpacing: 2,
            opacity: skillOpacity,
            marginBottom: 60,
          }}
        >
          <span style={{ width: 220, textAlign: "right" }}>{c.skillArc.legacyCaption}</span>
          <span style={{ width: 32 }} />
          <span style={{ width: 260, textAlign: "left" }}>{c.skillArc.codeCaption}</span>
        </div>

        {/* Footer line — locked separator sentence + stats kicker. */}
        <div
          className="font-mono"
          style={{
            opacity: footerOpacity,
            textAlign: "center",
            lineHeight: 1.4,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            alignItems: "center",
          }}
        >
          {/* Stats callout — gates aren't decoration. */}
          <div
            style={{
              fontSize: 44,
              color: "#f8fafc",
              fontWeight: 800,
              letterSpacing: -1,
              textShadow: "0 0 30px rgba(99,102,241,0.5)",
            }}
          >
            {c.stats.headline}{" "}
            <span style={{ color: "#6366f1" }}>{c.stats.sepChar}</span>{" "}
            <span style={{ color: "#22c55e" }}>5,439 tests</span>
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#94a3b8",
              letterSpacing: 2,
            }}
          >
            passed · 19 skipped · 0 failed
          </div>
          {/* Original separator sentence as ambient footer line. */}
          <div
            style={{
              fontSize: 22,
              color: "#475569",
              letterSpacing: 1,
              marginTop: 6,
            }}
          >
            {c.footerLineA}
            <span style={{ margin: "0 10px" }}>{c.footerSep}</span>
            {c.footerLineB}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
