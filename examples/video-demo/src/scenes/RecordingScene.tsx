import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import type { CaptionLine, CursorTick, LocaleId } from "../copy";
import { BrandBackground } from "./BrandBackground";
import { CaptionOverlay } from "./CaptionOverlay";
import { CursorHighlight } from "./CursorHighlight";
import { HudWindow } from "./HudWindow";

interface Props {
  locale: LocaleId;
  slug: string;
  captions: ReadonlyArray<CaptionLine>;
  cursor: ReadonlyArray<CursorTick>;
  hud?: {
    kind: "terminal" | "ide";
    lines: ReadonlyArray<string>;
    highlightIndexes?: ReadonlyArray<number>;
  };
  /** Per-scene accent color for the slug chip + HUD highlight stripe. */
  accentColor?: string;
}

/**
 * RecordingScene — one "scene" of the demo.
 * In the v5 pipeline this is where a Playwright-recorded clip would play,
 * with caption overlays + cursor highlights composited on top. Until the
 * Playwright pass records real footage, the HUD window acts as a
 * stand-in (it draws a stylised terminal/IDE that shows what would be
 * happening on screen).
 *
 * Transition behaviour is now owned by SceneTransition in Root.tsx.
 */
export const RecordingScene: React.FC<Props> = ({
  slug,
  captions,
  cursor,
  hud,
  accentColor = "#22c55e",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const enter = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const slide = interpolate(frame, [0, 18], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Fade out at the very end so the next scene transition is smooth.
  const fade = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <BrandBackground withHalo accentColor={accentColor} />

      {/* Slug chip + accent dot in the corner — accents each scene */}
      <div
        className="font-mono"
        style={{
          position: "absolute",
          top: 28,
          right: 36,
          fontSize: 14,
          color: "#64748b",
          letterSpacing: 3,
          textTransform: "uppercase",
          opacity: enter,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: 5,
            background: accentColor,
            boxShadow: `0 0 12px ${accentColor}`,
          }}
        />
        scene · {slug}
      </div>

      {/* The "recording" — until Playwright footage is in, render HUD */}
      {hud && (
        <div
          style={{
            transform: `translateX(${slide}px)`,
            opacity: enter,
            width: "100%",
            height: "100%",
          }}
        >
          <HudWindow
            kind={hud.kind}
            lines={hud.lines}
            highlightIndexes={hud.highlightIndexes}
          />
        </div>
      )}

      <CaptionOverlay captions={captions} durationInFrames={durationInFrames} />
      <CursorHighlight ticks={cursor} />
    </AbsoluteFill>
  );
};