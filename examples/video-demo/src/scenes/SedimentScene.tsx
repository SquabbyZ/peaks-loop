import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { COPY, type LocaleId } from "../copy";

interface Props {
  locale: LocaleId;
}

const MANIFEST_ROWS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "name", value: "bee-arxiv-daily" },
  { key: "trigger", value: "user: peaks-loop" },
  { key: "steps[4]", value: "fetch · dedupe · summarize · index" },
  { key: "gates[3]", value: "audit · test · ship" },
];

export const SedimentScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const localT = frame;
  const localDuration = durationInFrames;
  const beatW = localDuration / 3;
  const c = COPY[locale].sediment;

  const beatFor = (t: number) => Math.min(2, Math.floor(t / beatW));
  const beatTInBeat = (t: number) => t - beatFor(t) * beatW;
  const beatOpacity = (t: number) =>
    interpolate(beatTInBeat(t), [0, 6, beatW - 6, beatW], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const beatSlide = (t: number) =>
    interpolate(beatTInBeat(t), [0, 6, beatW - 6, beatW], [40, 0, 0, -40], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

  // === Cool effects ===
  // Halo behind manifest card — pulses on manifest beat.
  const haloOpacity = beatOpacity(localT) * 0.45;
  const haloScale = interpolate(localT % beatW, [0, beatW * 0.3, beatW], [0.7, 1.05, 1.1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const renderBeatHeadline = (beat: number) => {
    const beatData = c.beats[beat];
    if (!beatData) {
      return null;
    }
    const opacity = beatOpacity(localT);
    const slide = beatSlide(localT);
    if (beatFor(localT) !== beat || opacity <= 0.001) {
      return null;
    }
    return (
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.18),
          left: Math.round(width * 0.06),
          right: Math.round(width * 0.06),
          opacity,
          transform: `translateY(${slide}px)`,
        }}
      >
        <div
          className="font-mono"
          style={{
            fontSize: 28,
            color: "#6366f1",
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 22,
          }}
        >
          {beatData.kicker}
        </div>
        <div
          className="font-sans"
          style={{
            fontSize: 88,
            fontWeight: 800,
            color: "#f8fafc",
            lineHeight: 1.1,
            letterSpacing: -3,
            marginBottom: 12,
          }}
        >
          {beatData.headlineLineA}
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: 24,
            color: "#94a3b8",
            letterSpacing: 1,
            marginTop: 4,
          }}
        >
          {beatData.headlineSep} {beatData.headlineLineB}
        </div>
      </div>
    );
  };

  return (
    <AbsoluteFill className="bg-brand-bg" style={{ overflow: "hidden" }}>
      {/* Pulsing halo behind manifest card (beat 1). */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: Math.round(height * 0.50),
          width: 800,
          height: 800,
          marginLeft: -400,
          marginTop: -400,
          borderRadius: 400,
          background:
            "radial-gradient(circle, rgba(99,102,241,0.55) 0%, rgba(99,102,241,0) 70%)",
          transform: `scale(${haloScale})`,
          opacity: haloOpacity,
          pointerEvents: "none",
        }}
      />

      {/* Beat 1: NL */}
      {(() => {
        const beatData = c.beats[0];
        if (!beatData) {
          return null;
        }
        const opacity = beatOpacity(localT);
        const slide = beatSlide(localT);
        if (beatFor(localT) !== 0 || opacity <= 0.001) {
          return null;
        }
        return (
          <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
            {renderBeatHeadline(0)}
            <div
              style={{
                position: "absolute",
                top: Math.round(height * 0.55),
                left: Math.round(width * 0.10),
                width: Math.round(width * 0.80),
                background: "#1e293b",
                border: "1.5px solid #475569",
                borderLeft: "4px solid #6366f1",
                borderRadius: 18,
                padding: "22px 28px",
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                fontSize: 28,
                color: "#cbd5e1",
                boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
              }}
            >
              <span style={{ color: "#6366f1", marginRight: 18 }}>›</span>
              {beatData.bubbleLineA}
            </div>
          </div>
        );
      })()}

      {/* Beat 2: Manifest */}
      {(() => {
        const opacity = beatOpacity(localT);
        const slide = beatSlide(localT);
        if (beatFor(localT) !== 1 || opacity <= 0.001) {
          return null;
        }
        return (
          <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
            {renderBeatHeadline(1)}
            <div
              style={{
                position: "absolute",
                top: Math.round(height * 0.50),
                left: "50%",
                marginLeft: -360,
                width: 720,
                background: "#1e293b",
                border: "2px solid #6366f1",
                borderRadius: 22,
                padding: 26,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                boxShadow: "0 0 60px rgba(99,102,241,0.4)",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 18,
                  letterSpacing: 4,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                BeeManifest
              </div>
              {MANIFEST_ROWS.map((row) => (
                <div
                  key={row.key}
                  style={{
                    display: "flex",
                    gap: 24,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                    fontSize: 22,
                  }}
                >
                  <span style={{ color: "#94a3b8", width: 140 }}>{row.key}</span>
                  <span style={{ color: "#f8fafc" }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Beat 3: Bee */}
      {(() => {
        const beatData = c.beats[2];
        if (!beatData) {
          return null;
        }
        const opacity = beatOpacity(localT);
        const slide = beatSlide(localT);
        if (beatFor(localT) !== 2 || opacity <= 0.001) {
          return null;
        }
        // Bee card "pops in" with a tiny scale 0.92 → 1.
        const popScale = interpolate(
          beatTInBeat(localT),
          [0, 8, 18, beatW],
          [0.92, 1.04, 1, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          },
        );
        return (
          <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
            {renderBeatHeadline(2)}
            <div
              style={{
                position: "absolute",
                top: Math.round(height * 0.42),
                left: "50%",
                marginLeft: -230,
                width: 460,
                height: 360,
                background: "#1e293b",
                border: "2px solid #22c55e",
                borderRadius: 22,
                padding: 28,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 0 60px rgba(34,197,94,0.5)",
                transform: `scale(${popScale})`,
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 18,
                  letterSpacing: 5,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                }}
              >
                bee
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: "#f8fafc",
                  lineHeight: 1.2,
                }}
              >
                {beatData.bubbleLineA}
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 18,
                  color: "#22c55e",
                  letterSpacing: 4,
                  textTransform: "uppercase",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: "#22c55e",
                    boxShadow: "0 0 12px #22c55e",
                  }}
                />
                {beatData.bubbleLineB}
              </div>
            </div>
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};
