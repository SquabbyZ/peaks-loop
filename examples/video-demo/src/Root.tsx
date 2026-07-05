import { Composition, Series, AbsoluteFill } from "remotion";
import { TitleScene } from "./scenes/TitleScene";
import { DemoScene, type DemoSteps } from "./scenes/DemoScene";
import { SkillsWallScene } from "./scenes/SkillsWallScene";
import { ClosingScene } from "./scenes/ClosingScene";

export const TOTAL_FRAMES = 900; // 30 seconds @ 30fps

export const DEMO_SCENES: ReadonlyArray<{
  title: string;
  subtitle: string;
  steps: DemoSteps;
}> = [
  {
    title: "添加用户登录",
    subtitle: "Add user-login feature end-to-end",
    steps: ["peaks-code", "peaks-prd", "peaks-rd", "peaks-qa", "peaks-ui", "peaks-sc", "peaks-txt"],
  },
  {
    title: "修复登录页 bug",
    subtitle: "Fix login bug, ship quickly",
    steps: ["peaks-code", "peaks-rd", "peaks-qa", "peaks-sc"],
  },
  {
    title: "重构认证模块",
    subtitle: "Refactor the auth module",
    steps: ["peaks-code", "peaks-prd", "peaks-rd", "peaks-qa", "peaks-sc"],
  },
];

const PeaksCodeDemo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Series>
        <Series.Sequence durationInFrames={90}>
          <TitleScene from={0} to={90} />
        </Series.Sequence>
        {DEMO_SCENES.map((s, idx) => (
          <Series.Sequence key={idx} durationInFrames={180}>
            <DemoScene
              from={90 + idx * 180}
              to={90 + (idx + 1) * 180}
              title={s.title}
              subtitle={s.subtitle}
              steps={[...s.steps]}
              sceneIndex={idx}
            />
          </Series.Sequence>
        ))}
        <Series.Sequence durationInFrames={180}>
          <SkillsWallScene from={630} to={810} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={90}>
          <ClosingScene from={810} to={900} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="peaks-code-demo"
        component={PeaksCodeDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

export const Root = RemotionRoot;
