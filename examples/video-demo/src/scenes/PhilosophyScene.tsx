import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { COPY, type LocaleId } from "../copy";

interface Props {
  locale: LocaleId;
}

const PHILOSOPHY_TEXT: ReadonlyArray<{ num: string; zh: string; en: string }> = [
  { num: "#01", zh: "极客精神。", en: "Geek ethos." },
  { num: "#02", zh: "你跟 AI 之间只该用自然语言讲话,没有 CLI 表面给你。", en: "Natural language only — no CLI surface for the user." },
  { num: "#03", zh: "单测覆盖率和门禁审计真挡得住事,不是装饰。", en: "Tests and gates that actually block, not decorate." },
  { num: "#04", zh: "严于律己,宽以待人 —— 自己写的代码过自己的门,使用者随便怎么说都能跑通。", en: "Strict with self, lenient with users — our own code goes through our own gates; users say whatever they want, the system catches it." },
  { num: "#05", zh: "AI 使用水平的下限平权:你不需要懂 prompt engineering,就跟说话一样用。", en: "AI fluency floor is flat — no prompt-engineering chops, no CLI muscle memory; you talk like a person." },
];

export const PhilosophyScene: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const localT = frame;
  const localDuration = durationInFrames;
  const itemWindow = localDuration / PHILOSOPHY_TEXT.length;
  const c = COPY[locale].philosophy;

  const footerOpacity = interpolate(localT, [0, 18, localDuration - 18, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const footerY = interpolate(localT, [0, 18], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill className="bg-brand-bg">
      {/* Footer uses locked separator sentence. */}
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.85),
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: footerOpacity,
          transform: `translateY(${footerY}px)`,
        }}
      >
        <span className="font-mono" style={{ fontSize: 32, color: "#6366f1", letterSpacing: 2 }}>
          {c.footerLineA}
          <span style={{ color: "#94a3b8", margin: "0 12px" }}>{c.footerSep}</span>
          <span style={{ color: "#f8fafc" }}>{c.footerLineB}</span>
        </span>
      </div>
      {PHILOSOPHY_TEXT.map((item, i) => {
        const winStart = i * itemWindow;
        const enterEnd = winStart + 6;
        const exitStart = (i + 1) * itemWindow - 4;
        const exitEnd = (i + 1) * itemWindow;
        const enterX = interpolate(localT, [winStart, enterEnd], [80, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const exitX = interpolate(localT, [exitStart, exitEnd], [0, -40], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const opacity = interpolate(
          localT,
          [winStart, enterEnd, exitStart, exitEnd],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );
        const visible = opacity > 0.001;
        if (!visible) {
          return null;
        }
        // Each card gets a slow "scale settle" 0.96 -> 1 as it fully enters.
        const cardScale = interpolate(localT, [winStart, enterEnd + 4], [0.96, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const primaryLine = locale === "zh" ? item.zh : item.en;
        const subLine = locale === "zh" ? item.en : item.zh;
        return (
          <div
            key={item.num}
            style={{
              position: "absolute",
              top: Math.round(height * 0.30),
              left: Math.round(width * 0.10),
              width: Math.round(width * 0.80),
              opacity,
              transform: `translateX(${enterX + exitX}px) scale(${cardScale})`,
              transformOrigin: "top left",
            }}
          >
            <div className="font-mono" style={{ fontSize: 56, color: "#6366f1", fontWeight: 700, marginBottom: 28 }}>
              {item.num}
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 28,
                color: "#94a3b8",
                lineHeight: 1.3,
                maxWidth: 1200,
                marginBottom: 18,
              }}
            >
              {subLine}
            </div>
            <div
              className="font-sans"
              style={{
                fontSize: 56,
                fontWeight: 800,
                color: "#f8fafc",
                lineHeight: 1.25,
                maxWidth: 1200,
                letterSpacing: -1,
              }}
            >
              {primaryLine}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
