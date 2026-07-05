import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

interface Props {
  from: number;
  to: number;
}

export const ClosingScene: React.FC<Props> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < from || frame >= to) {
    return null;
  }

  const localT = frame - from;
  const localDuration = to - from;

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

  return (
    <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
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
          }}
        >
          npm i -g peaks-loop
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
            peaks-cli (was)
          </span>
          <span style={{ fontSize: 32, color: "#6366f1" }}>→</span>
          <span style={{ fontSize: 40, fontWeight: 800, color: "#f8fafc" }}>
            peaks-loop (now)
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
          repo · was, now
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
          <span style={{ fontSize: 28, color: "#94a3b8" }}>peaks-solo</span>
          <span style={{ fontSize: 32, color: "#6366f1" }}>→</span>
          <span style={{ fontSize: 36, fontWeight: 800, color: "#f8fafc" }}>
            peaks-code
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
          <span style={{ width: 180, textAlign: "right" }}>
            single-role (legacy)
          </span>
          <span style={{ width: 32 }} />
          <span style={{ width: 220, textAlign: "left" }}>
            gate-bearing, code-domain
          </span>
        </div>

        {/* Footer line — zh + en */}
        <div
          className="font-mono"
          style={{
            fontSize: 32,
            color: "#94a3b8",
            opacity: footerOpacity,
            textAlign: "center",
            letterSpacing: 1,
          }}
        >
          你说话,它替你排工程门禁 — fail where it fails, you decide.
        </div>
      </div>
    </AbsoluteFill>
  );
};