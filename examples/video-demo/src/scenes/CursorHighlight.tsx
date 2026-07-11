import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from "remotion";
import type { CursorTick } from "../copy";

interface Props {
  /** Cursor choreography in scene-normalized coords (0..1). */
  ticks: ReadonlyArray<CursorTick>;
}

/**
 * CursorHighlight — smooth interpolation between cursor waypoints, plus an
 * optional click ripple. Inspired by web-demo-video_skills/cursor-highlight.md.
 */
export const CursorHighlight: React.FC<Props> = ({ ticks }) => {
  const frame = useCurrentFrame();

  if (ticks.length === 0) {
    return null;
  }

  // Resolve current target by finding the latest tick whose `at` <= frame.
  let current: CursorTick = ticks[0]!;
  let prev: CursorTick = ticks[0]!;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!;
    if (t.at <= frame) {
      prev = current;
      current = t;
    } else {
      break;
    }
  }

  const dur = current.durationFrames ?? 10;
  const progress = interpolate(frame, [current.at, current.at + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const x = (prev.x + (current.x - prev.x) * progress) * 100;
  const y = (prev.y + (current.y - prev.y) * progress) * 100;

  // Click ripple: small expanding ring for 8 frames after click.
  const clickStart = current.click ? current.at + dur - 1 : -1;
  const rippleScale = interpolate(frame, [clickStart, clickStart + 8], [0.4, 2.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const rippleOpacity = interpolate(frame, [clickStart, clickStart + 8], [0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Click ripple */}
      {current.click && rippleOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            left: `${x}%`,
            top: `${y}%`,
            width: 28,
            height: 28,
            marginLeft: -14,
            marginTop: -14,
            borderRadius: 14,
            border: "2px solid #f8fafc",
            transform: `scale(${rippleScale})`,
            opacity: rippleOpacity,
          }}
        />
      )}
      {/* Cursor body — simple macOS-style arrow drawn as SVG */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        style={{
          position: "absolute",
          left: `${x}%`,
          top: `${y}%`,
          marginLeft: -2,
          marginTop: -2,
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
        }}
      >
        <path
          d="M 2 2 L 2 22 L 8 16 L 12 24 L 16 22 L 12 14 L 20 14 Z"
          fill="#f8fafc"
          stroke="#1e293b"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </AbsoluteFill>
  );
};