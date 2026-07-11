import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from "remotion";
import type { CaptionLine } from "../copy";

interface Props {
  captions: ReadonlyArray<CaptionLine>;
  /** Total frames of the scene (for indexing). */
  durationInFrames: number;
}

/**
 * CaptionOverlay — three styles inspired by web-demo-video_skills:
 *   - subtitle:    black semi-transparent bar at the bottom
 *   - callout:     indigo emphasis box, slides in from the left
 *   - annotation:  white bubble with a pointer, drops in from the top
 *
 * Each caption is held for the rest of the scene after it appears.
 */
export const CaptionOverlay: React.FC<Props> = ({ captions, durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {captions.map((cap, i) => {
        const enterAt = cap.enterAt ?? i * 18;
        const opacity = interpolate(frame, [enterAt, enterAt + 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const slide = (dir: "left" | "top" | "bottom") => {
          if (dir === "left") {
            return interpolate(frame, [enterAt, enterAt + 12], [-30, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
          }
          if (dir === "top") {
            return interpolate(frame, [enterAt, enterAt + 12], [-24, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
          }
          return interpolate(frame, [enterAt, enterAt + 12], [24, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
        };

        if (cap.style === "subtitle") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                bottom: 56,
                left: 0,
                right: 0,
                opacity,
                transform: `translateY(${slide("bottom")}px)`,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 28,
                  color: "#f8fafc",
                  background: "rgba(15,23,42,0.78)",
                  padding: "12px 28px",
                  borderRadius: 12,
                  letterSpacing: 0.5,
                  boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
                }}
              >
                {cap.text}
              </div>
            </div>
          );
        }

        if (cap.style === "callout") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: 48,
                left: 64,
                opacity,
                transform: `translateX(${slide("left")}px)`,
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 26,
                  color: "#f8fafc",
                  background: "linear-gradient(90deg, rgba(99,102,241,0.95), rgba(99,102,241,0.7))",
                  padding: "14px 28px",
                  borderRadius: 10,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  boxShadow: "0 8px 32px rgba(99,102,241,0.5)",
                }}
              >
                {cap.text}
              </div>
            </div>
          );
        }

        // annotation — speech bubble style, top-right
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 64,
              right: 64,
              opacity,
              transform: `translateY(${slide("top")}px)`,
              maxWidth: 560,
            }}
          >
            <div
              className="font-mono"
              style={{
                fontSize: 20,
                color: "#1e293b",
                background: "#fef3c7",
                padding: "12px 22px",
                borderRadius: 14,
                border: "1.5px solid #f59e0b",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                lineHeight: 1.4,
              }}
            >
              {cap.text}
            </div>
            <div
              style={{
                position: "absolute",
                bottom: -10,
                left: 32,
                width: 16,
                height: 16,
                background: "#fef3c7",
                borderLeft: "1.5px solid #f59e0b",
                borderBottom: "1.5px solid #f59e0b",
                transform: "rotate(-45deg)",
              }}
            />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};