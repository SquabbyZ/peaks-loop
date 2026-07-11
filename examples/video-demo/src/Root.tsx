import { Composition, Series, AbsoluteFill } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { RecordingScene } from "./scenes/RecordingScene";
import { CreditScene } from "./scenes/CreditScene";
import { ClosingScene } from "./scenes/ClosingScene";
import { SceneTransition } from "./SceneTransition";
import { COPY, type LocaleId } from "./copy";

/**
 * Per-scene enter direction. Cycles through cinematic variants so the
 * 30s timeline doesn't feel like the same wipe 7 times in a row.
 */
export const OVERLAP = 22;

type SceneSpec = {
  id: string;
  bodyFrames: number;
  direction: "from-right" | "from-left" | "zoom-in" | "zoom-out" | "wipe";
  render: (locale: LocaleId) => React.ReactElement;
};

// v5.2 narrative: Intro → 5 recording scenes → Credit → Closing.
// Each scene picks a different transition direction for visual rhythm.
const SCENES: ReadonlyArray<SceneSpec> = [
  { id: "intro", bodyFrames: 90, direction: "zoom-in", render: (l) => <IntroScene locale={l} /> },
  ...COPY.zh.recordings.map((rec, idx) => ({
    id: `record-${rec.slug}`,
    bodyFrames: 100,
    direction: (["from-right", "from-left", "wipe", "zoom-in", "from-right"] as const)[idx]!,
    render: (l: LocaleId) => (
      <RecordingScene
        locale={l}
        slug={COPY[l].recordings[idx]!.slug}
        captions={COPY[l].recordings[idx]!.captions}
        cursor={COPY[l].recordings[idx]!.cursor}
        hud={COPY[l].recordings[idx]!.hud}
        accentColor={(["#6366f1", "#22c55e", "#a78bfa", "#22c55e", "#22c55e"] as const)[idx]!}
      />
    ),
  })),
  { id: "credit", bodyFrames: 130, direction: "zoom-out", render: (l) => <CreditScene locale={l} /> },
  { id: "closing", bodyFrames: 110, direction: "from-left", render: (l) => <ClosingScene locale={l} /> },
];

const SCENE_TOTAL_FRAMES =
  SCENES.reduce((sum, s) => sum + s.bodyFrames, 0) +
  (SCENES.length - 1) * OVERLAP +
  OVERLAP;
export const TOTAL_FRAMES = SCENE_TOTAL_FRAMES;

const makeComposition = (locale: LocaleId): React.FC =>
  () =>
    (
      <AbsoluteFill>
        <Series>
          {SCENES.map((scene, idx) => {
            const seqLen = scene.bodyFrames + OVERLAP + (idx === 0 ? OVERLAP : 0);
            return (
              <Series.Sequence key={scene.id} durationInFrames={seqLen}>
                <SceneTransition overlapFrames={OVERLAP} direction={scene.direction}>
                  {scene.render(locale)}
                </SceneTransition>
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