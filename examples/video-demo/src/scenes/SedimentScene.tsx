import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

interface Props {
  from: number;
  to: number;
}

const NL_LINE =
  "把'抓 arxiv 每日论文 → 清理 → 入库'沉淀成我的 bee";

const MANIFEST_ROWS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "name", value: "bee-arxiv-daily" },
  { key: "trigger", value: "user: peaks-loop" },
  { key: "steps[4]", value: "fetch · dedupe · summarize · index" },
  { key: "gates[3]", value: "audit · test · ship" },
];

export const SedimentScene: React.FC<Props> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < from || frame >= to) {
    return null;
  }

  const localT = frame - from;
  const localDuration = to - from;
  const beatW = localDuration / 3; // 80

  // Beats 0 (NL) / 1 (Manifest) / 2 (Bee). Each beat: fade-in 0..6, hold, fade-out at beatW-6..beatW.
  const beatFor = (t: number) => Math.min(2, Math.floor(t / beatW));
  const beatTInBeat = (t: number) => t - beatFor(t) * beatW;
  const beatOpacity = (t: number) => {
    const lt = beatTInBeat(t);
    return interpolate(lt, [0, 6, beatW - 6, beatW], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  };
  const beatSlide = (t: number) => {
    const lt = beatTInBeat(t);
    return interpolate(lt, [0, 6, beatW - 6, beatW], [40, 0, 0, -40], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
  };

  const renderBeatHeadline = (beat: number, kicker: string, zh: string, en: string) => {
    const opacity = beatOpacity(localT);
    const slide = beatSlide(localT);
    const inThisBeat = beatFor(localT) === beat && opacity > 0.001;
    if (!inThisBeat) {
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
          {kicker}
        </div>
        <div
          className="font-sans"
          style={{
            fontSize: 96,
            fontWeight: 800,
            color: "#f8fafc",
            lineHeight: 1.05,
            letterSpacing: -3,
            marginBottom: 16,
          }}
        >
          {zh}
        </div>
        <div
          className="font-mono"
          style={{ fontSize: 26, color: "#94a3b8", letterSpacing: 1 }}
        >
          {en}
        </div>
      </div>
    );
  };

  // Render beats in DOM order — React uses CSS-driven opacity to hide ones not in beatFor(t).
  return (
    <AbsoluteFill className="bg-brand-bg">
      {/* Beat 1: NL */}
      {(() => {
        const opacity = beatOpacity(localT);
        const slide = beatSlide(localT);
        if (beatFor(localT) !== 0 || opacity <= 0.001) {
          return null;
        }
        return (
          <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
            {renderBeatHeadline(0, "NL", "跑过一次还想跑", "say once to keep it forever")}
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
              }}
            >
              <span style={{ color: "#6366f1", marginRight: 18 }}>›</span>
              {NL_LINE}
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
            {renderBeatHeadline(1, "MANIFEST", "沉淀成战术套路", "sediment the playbook, not the spell")}
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
        const opacity = beatOpacity(localT);
        const slide = beatSlide(localT);
        if (beatFor(localT) !== 2 || opacity <= 0.001) {
          return null;
        }
        return (
          <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
            {renderBeatHeadline(2, "BEE", "驻场,下次说跑就跑", "the bee is grounded; run it again next time")}
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
                boxShadow: "0 0 36px rgba(34,197,94,0.35)",
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
                bee-arxiv-daily
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 18,
                  color: "#22c55e",
                  letterSpacing: 4,
                  textTransform: "uppercase",
                }}
              >
                ● STABLE
              </div>
            </div>
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};
