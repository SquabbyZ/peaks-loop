import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

interface Props {
  from: number;
  to: number;
}

const ITEMS: ReadonlyArray<{ num: string; zh: string; en: string }> = [
  {
    num: "#01",
    zh: "极客精神。",
    en: "Geek ethos.",
  },
  {
    num: "#02",
    zh: "你跟 AI 之间只该用自然语言讲话,没有 CLI 表面给你。",
    en: "Natural language only — no CLI surface for the user.",
  },
  {
    num: "#03",
    zh: "单测覆盖率和门禁审计真挡得住事,不是装饰。",
    en: "Tests and gates that actually block, not decorate.",
  },
  {
    num: "#04",
    zh: "严于律己,宽以待人 —— 自己写的代码过自己的门,使用者随便怎么说都能跑通。",
    en: "Strict with self, lenient with users — our own code goes through our own gates; users say whatever they want, the system catches it.",
  },
  {
    num: "#05",
    zh: "AI 使用水平的下限平权:你不需要懂 prompt engineering,就跟说话一样用。",
    en: "AI fluency floor is flat — no prompt-engineering chops, no CLI muscle memory; you talk like a person.",
  },
];

const FOOTER = "做这个项目的只有一个人,工程师口味。";

export const PhilosophyScene: React.FC<Props> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < from || frame >= to) {
    return null;
  }
  const localT = frame - from;
  const localDuration = to - from;
  const itemWindow = localDuration / ITEMS.length;

  const footerOpacity = interpolate(localT, [0, 18, localDuration - 18, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="bg-brand-bg">
      <div
        style={{
          position: "absolute",
          top: Math.round(height * 0.85),
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: footerOpacity,
        }}
      >
        <span className="font-mono" style={{ fontSize: 32, color: "#6366f1", letterSpacing: 2 }}>
          {FOOTER}
        </span>
      </div>
      {ITEMS.map((item, i) => {
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
        return (
          <div
            key={item.num}
            style={{
              position: "absolute",
              top: Math.round(height * 0.30),
              left: Math.round(width * 0.10),
              width: Math.round(width * 0.80),
              opacity,
              transform: `translateX(${enterX + exitX}px)`,
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
              {item.en}
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
              {item.zh}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
