import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig, Easing } from "remotion";

interface Props {
  /** Slowly drifting indigo halo for "alive" feel. */
  withHalo?: boolean;
  /** Optional scene-local accent that tints the inner halo. */
  accentColor?: string;
}

/**
 * BrandBackground — peaks-loop brand colours with much more v5.2 motion:
 *   - Two overlapping halos (indigo + accent), each pulsing independently
 *   - Counter-rotating diagonal sweep lines
 *   - A faint grain texture layer (radial-noise dots) to break the gradient
 *   - A "breathing" vignette that tightens around the centre as the scene
 *     ages (camera focus effect)
 *
 * Single source of truth for the look so every scene stays consistent.
 */
export const BrandBackground: React.FC<Props> = ({ withHalo = true, accentColor = "#22c55e" }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // Two counter-rotating diagonal sweep lines
  const sweepX1 = interpolate(frame, [0, durationInFrames], [-400, width + 400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sweepX2 = interpolate(frame, [0, durationInFrames], [width + 400, -400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Two halos pulse out of phase
  const pulseA = interpolate(
    frame,
    [0, durationInFrames * 0.5, durationInFrames],
    [0.35, 0.55, 0.4],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );
  const pulseB = interpolate(
    frame,
    [0, durationInFrames * 0.5, durationInFrames],
    [0.25, 0.5, 0.3],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );

  // Slow camera focus: vignette tightens at 60% of scene
  const vignette = interpolate(
    frame,
    [durationInFrames * 0.3, durationInFrames],
    [1, 0.85],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
  );

  // Halo position drifts in a slow figure-8 so the gradient never sits still
  const haloDriftX = interpolate(
    frame,
    [0, durationInFrames * 0.5, durationInFrames],
    [0, 60, -40],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );
  const haloDriftY = interpolate(
    frame,
    [0, durationInFrames * 0.5, durationInFrames],
    [0, -30, 20],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }
  );

  return (
    <AbsoluteFill className="bg-brand-bg" style={{ overflow: "hidden" }}>
      {/* Indigo primary halo (drifting) */}
      {withHalo && (
        <div
          style={{
            position: "absolute",
            width: 1500,
            height: 1500,
            left: `calc(50% + ${haloDriftX}px)`,
            top: `calc(50% + ${haloDriftY}px)`,
            marginLeft: -750,
            marginTop: -750,
            background:
              "radial-gradient(circle, rgba(99,102,241,0.6) 0%, rgba(99,102,241,0) 65%)",
            opacity: pulseA,
            pointerEvents: "none",
          }}
        />
      )}
      {/* Accent halo (counter-phase) */}
      {withHalo && (
        <div
          style={{
            position: "absolute",
            width: 1100,
            height: 1100,
            left: `calc(50% - ${haloDriftX * 0.6}px)`,
            top: `calc(50% + ${haloDriftY * 0.4 + 80}px)`,
            marginLeft: -550,
            marginTop: -550,
            background: `radial-gradient(circle, ${hexToRgba(accentColor, 0.25)} 0%, ${hexToRgba(accentColor, 0)} 70%)`,
            opacity: pulseB,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Sweep line 1 (forward) */}
      <div
        style={{
          position: "absolute",
          left: sweepX1,
          top: 0,
          width: 220,
          height: "100%",
          background:
            "linear-gradient(90deg, rgba(99,102,241,0) 0%, rgba(99,102,241,0.20) 50%, rgba(99,102,241,0) 100%)",
          transform: "skewX(-12deg)",
          pointerEvents: "none",
        }}
      />
      {/* Sweep line 2 (backward, slower, accent) */}
      <div
        style={{
          position: "absolute",
          left: sweepX2,
          top: 0,
          width: 160,
          height: "100%",
          background: `linear-gradient(90deg, ${hexToRgba(accentColor, 0)} 0%, ${hexToRgba(accentColor, 0.12)} 50%, ${hexToRgba(accentColor, 0)} 100%)`,
          transform: "skewX(8deg)",
          pointerEvents: "none",
        }}
      />

      {/* Bottom glow */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: -200,
          height: 500,
          background:
            "radial-gradient(ellipse at center bottom, rgba(34,197,94,0.10) 0%, rgba(34,197,94,0) 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Vignette (camera focus) */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)",
          opacity: vignette,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

function hexToRgba(hex: string, alpha: number): string {
  // Supports #rgb / #rrggbb
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return `rgba(99,102,241,${alpha})`;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}