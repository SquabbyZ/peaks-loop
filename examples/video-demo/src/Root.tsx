import { Composition, Series, AbsoluteFill } from "remotion";
import { TitleScene } from "./scenes/TitleScene";
import { PhilosophyScene } from "./scenes/PhilosophyScene";
import { DemoScene, type DemoSteps } from "./scenes/DemoScene";
import { SedimentScene } from "./scenes/SedimentScene";
import { ClosingScene } from "./scenes/ClosingScene";
import { TransitionFade } from "./TransitionFade";
import { COPY, type LocaleId } from "./copy";

export const OVERLAP = 15;

type SceneSpec =
  | { id: string; bodyFrames: number; render: (locale: LocaleId) => React.ReactElement }
  | {
      id: string;
      bodyFrames: number;
      component: React.ComponentType<{
        locale: LocaleId;
        title: string;
        subtitle: string;
        steps: DemoSteps;
        sceneIndex: number;
      }>;
      title: string;
      subtitle: string;
      steps: DemoSteps;
      sceneIndex: number;
    };

const SCENES: ReadonlyArray<SceneSpec> = [
  { id: "title", bodyFrames: 90, render: (l) => <TitleScene locale={l} /> },
  { id: "philosophy", bodyFrames: 150, render: (l) => <PhilosophyScene locale={l} /> },
  // Demos carry their own copy array per locale — we hand-pick it at render time.
  ...(COPY.zh.demos.map((_, idx) => ({
    id: `demo-${idx}`,
    bodyFrames: 100,
    component: DemoScene,
    title: COPY.zh.demos[idx].title,
    subtitle: COPY.zh.demos[idx].subtitle,
    steps: [...COPY.zh.demos[idx].steps],
    sceneIndex: idx,
  })) as unknown as ReadonlyArray<SceneSpec>),
  { id: "sediment", bodyFrames: 240, render: (l) => <SedimentScene locale={l} /> },
  { id: "closing", bodyFrames: 120, render: (l) => <ClosingScene locale={l} /> },
];

const SCENE_TOTAL_FRAMES =
  SCENES.reduce((sum, s) => sum + s.bodyFrames, 0) + (SCENES.length - 1) * OVERLAP + OVERLAP;
export const TOTAL_FRAMES = SCENE_TOTAL_FRAMES;

const makeComposition = (locale: LocaleId): React.FC =>
  () =>
    (
      <AbsoluteFill>
        <Series>
          {SCENES.map((scene, idx) => {
            const seqLen =
              scene.bodyFrames + OVERLAP + (idx === 0 ? OVERLAP : 0);
            return (
              <Series.Sequence key={scene.id} durationInFrames={seqLen}>
                <TransitionFade overlapFrames={OVERLAP}>
                  {"render" in scene
                    ? scene.render(locale)
                    : (() => {
                        // Demo scenes: swap per-locale title/subtitle/steps at render time.
                        const d = COPY[locale].demos[scene.sceneIndex];
                        return (
                          <scene.component
                            locale={locale}
                            title={d.title}
                            subtitle={d.subtitle}
                            steps={[...d.steps]}
                            sceneIndex={scene.sceneIndex}
                          />
                        );
                      })()}
                </TransitionFade>
              </Series.Sequence>
            );
          })}
        </Series>
      </AbsoluteFill>
    );

const PeAKsLoopZh = makeComposition("zh");
const PeAKsLoopEn = makeComposition("en");

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="peaks-loop-demo"
        component={PeAKsLoopZh}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="peaks-loop-demo-en"
        component={PeAKsLoopEn}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

export const Root = RemotionRoot;
