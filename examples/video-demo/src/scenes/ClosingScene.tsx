import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import type { LocaleId } from "../copy";
import { COPY } from "../copy";
import { BrandBackground } from "./BrandBackground";

interface Props {
  locale: LocaleId;
}

/**
 * ClosingScene — install chip + 5,439 tests stats.
 *
 * v5.2: fixed layout bug (chip + stats were stacked diagonally because the
 * inner `flex-col items-center` collapsed to content width and then sat
 * next to whatever happened to be in the flex-row outer container).
 * Now we use absolute-positioned children pinned to the same vertical
 * column inside an `AbsoluteFill` so the layout is deterministic.
 *
 * Visual: chip drops in from above, stats slide up from below, then both
 * settle and a sweep line + green halo pulses behind. The camera (scale
 * on the inner group) starts at 0.96 and eases to 1.0 across the scene.
 */
export const ClosingScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { width, durationInFrames } = useVideoConfig();
  const c = COPY[locale].closing;

  // Chip animation
  const chipOpacity = interpolate(
    frame,
    [0, 18, durationInFrames - 18, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const chipY = interpolate(frame, [0, 22], [-50, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Stats animation — appears later and stays longer than v5.1 (where it
  // disappeared mid-scene because of layout collapse).
  const statsOpacity = interpolate(
    frame,
    [22, 50, durationInFrames - 22, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const statsY = interpolate(frame, [22, 50], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Camera ease-in: subtle zoom from 0.96 → 1.0 over the whole scene.
  const cameraScale = interpolate(frame, [0, durationInFrames], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Green halo pulse behind the stats
  const greenHalo = interpolate(frame, [30, 60, 90], [0, 0.5, 0.25], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Slow diagonal sweep
  const sweepX = interpolate(frame, [0, durationInFrames], [-300, width + 300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="bg-brand-bg">
      <BrandBackground withHalo accentColor="#22c55e" />

      {/* Sweep line on top of brand bg */}
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

      {/* Centered column — explicit absolute positioning, no flex magic. */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            transform: `scale(${cameraScale})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 60,
            width: "100%",
          }}
        >
          {/* Chip — pinned centered, drops in from above */}
          <div
            className="font-mono"
            style={{
              fontSize: 64,
              color: "#f8fafc",
              background: "#1e293b",
              padding: "22px 44px",
              borderRadius: 16,
              border: "2px solid #6366f1",
              opacity: chipOpacity,
              transform: `translateY(${chipY}px)`,
              boxShadow: "0 0 40px rgba(99,102,241,0.5)",
              position: "relative",
              zIndex: 2,
            }}
          >
            {c.chip}
          </div>

          {/* Stats block — pinned centered, slides up from below. */}
          <div
            style={{
              position: "relative",
              opacity: statsOpacity,
              transform: `translateY(${statsY}px)`,
              textAlign: "center",
              zIndex: 2,
            }}
          >
            {/* Green halo behind the stats */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 1000,
                height: 400,
                marginLeft: -500,
                marginTop: -200,
                background:
                  "radial-gradient(ellipse at center, rgba(34,197,94,0.45) 0%, rgba(34,197,94,0) 70%)",
                opacity: greenHalo,
                pointerEvents: "none",
                zIndex: -1,
              }}
            />
            <div
              className="font-mono"
              style={{
                fontSize: 64,
                color: "#f8fafc",
                fontWeight: 800,
                letterSpacing: -1,
                textShadow: "0 0 30px rgba(99,102,241,0.5)",
                lineHeight: 1.05,
              }}
            >
              {c.stats.headline}{" "}
              <span style={{ color: "#6366f1" }}>{c.stats.sepChar}</span>{" "}
              <span style={{ color: "#22c55e" }}>5,439 tests</span>
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 28,
                color: "#94a3b8",
                letterSpacing: 3,
                marginTop: 16,
              }}
            >
              {c.stats.subline}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};