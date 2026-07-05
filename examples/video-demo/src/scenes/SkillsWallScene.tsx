import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

const SKILLS = [
  "peaks-code",
  "peaks-resume",
  "peaks-status",
  "peaks-test",
  "peaks-prd",
  "peaks-rd",
  "peaks-qa",
  "peaks-ui",
  "peaks-sc",
  "peaks-txt",
  "peaks-sop",
];

interface Props {
  from: number;
  to: number;
}

export const SkillsWallScene: React.FC<Props> = ({ from, to }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) {
    return null;
  }

  const localT = frame - from;
  const localDuration = to - from;
  const cols = 4;
  const rows = Math.ceil(SKILLS.length / cols);

  const cellWidth = Math.round((1920 - 160 * 2) / cols);
  const cellHeight = Math.round((1080 - 280) / rows);
  const startX = 160;
  const startY = 240;

  const titleOpacity = interpolate(localT, [0, 20, localDuration - 30, localDuration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="bg-brand-bg">
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 160,
          right: 160,
          opacity: titleOpacity,
        }}
      >
        <div className="font-sans text-brand-fg" style={{ fontSize: 110, fontWeight: 800, letterSpacing: -3 }}>
          11 skill gates
        </div>
        <div className="font-mono text-brand-accent mt-4" style={{ fontSize: 32 }}>
          the Peaks-Loop skill family — coordinated, gated, autonomous
        </div>
      </div>

      {SKILLS.map((name, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = startX + col * cellWidth;
        const y = startY + row * cellHeight;

        const appearStart = 20 + idx * 10;
        const appearEnd = appearStart + 25;
        const opacity = interpolate(localT, [appearStart, appearEnd], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const slideY = interpolate(localT, [appearStart, appearEnd], [30, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={name}
            style={{
              position: "absolute",
              top: y,
              left: x,
              width: cellWidth - 20,
              height: cellHeight - 20,
              opacity,
              transform: `translateY(${slideY}px)`,
              background: "#1e293b",
              border: "2px solid #6366f1",
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              padding: 20,
            }}
          >
            <div className="font-mono text-brand-fg" style={{ fontSize: 44, fontWeight: 700, textAlign: "center" }}>
              {name}
            </div>
            <div className="font-mono text-brand-accent mt-2" style={{ fontSize: 22 }}>
              gate {idx + 1}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
