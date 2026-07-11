import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from "remotion";

interface Props {
  kind: "terminal" | "ide";
  lines: ReadonlyArray<string>;
  highlightIndexes?: ReadonlyArray<number>;
  /** When this HUD scene appears (frame-relative to scene start). */
  enterAt?: number;
}

/**
 * HudWindow — a stylized terminal/IDE panel that types out lines one at a
 * time. Inspired by web-demo-video_skills (their `hud` action type).
 *
 * - terminal: dark slate background, monospaced, $ prompt.
 * - ide:      slightly lighter, chat-bubble style entries, prompt ›
 */
export const HudWindow: React.FC<Props> = ({ kind, lines, highlightIndexes, enterAt = 0 }) => {
  const frame = useCurrentFrame();

  const enter = interpolate(frame, [enterAt, enterAt + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const slide = interpolate(frame, [enterAt, enterAt + 16], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Type-out timing: each line appears 8 frames after the previous.
  const lineAppear = (idx: number) => {
    const startAt = enterAt + 10 + idx * 10;
    return interpolate(frame, [startAt, startAt + 6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  };

  const isHighlighted = (idx: number) =>
    highlightIndexes ? highlightIndexes.includes(idx) : false;

  const titleBar =
    kind === "terminal"
      ? "● zsh — npm install peaks-loop"
      : "● Claude Code · /peaks-code · peaks-loop 4.x";

  const bgColor = kind === "terminal" ? "#0b1120" : "#0f172a";
  const titleColor = kind === "terminal" ? "#94a3b8" : "#a5b4fc";
  const promptColor = kind === "terminal" ? "#22c55e" : "#6366f1";

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 1080,
        maxWidth: "88%",
        transform: `translate(-50%, calc(-50% + ${slide}px))`,
        opacity: enter,
      }}
    >
      <div
        style={{
          background: bgColor,
          borderRadius: 16,
          border: "1.5px solid #334155",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(99,102,241,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            background: "#1e293b",
            borderBottom: "1px solid #334155",
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#ef4444" }} />
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#f59e0b" }} />
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#22c55e" }} />
          <div
            className="font-mono"
            style={{
              marginLeft: 14,
              fontSize: 14,
              color: titleColor,
              letterSpacing: 0.5,
            }}
          >
            {titleBar}
          </div>
        </div>

        {/* Body */}
        <div
          className="font-mono"
          style={{
            padding: "24px 28px",
            fontSize: 22,
            lineHeight: 1.6,
            color: "#cbd5e1",
          }}
        >
          {lines.map((line, idx) => {
            const opacity = lineAppear(idx);
            const accent = isHighlighted(idx);
            // Highlighted lines: cyan accent border on the left.
            return (
              <div
                key={idx}
                style={{
                  opacity,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  padding: "4px 10px",
                  marginLeft: -10,
                  marginRight: -10,
                  borderLeft: accent ? "3px solid #22c55e" : "3px solid transparent",
                  background: accent ? "rgba(34,197,94,0.08)" : "transparent",
                  borderRadius: 4,
                }}
              >
                <span style={{ color: promptColor, fontWeight: 700 }}>
                  {kind === "terminal" ? "$" : "›"}
                </span>
                <span
                  style={{
                    color: accent ? "#f8fafc" : "#cbd5e1",
                    fontWeight: accent ? 600 : 400,
                  }}
                >
                  {line.replace(/^[$›]\s*/, "")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};