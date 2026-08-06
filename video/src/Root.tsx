import React from "react";
import { Composition } from "remotion";
import { TheRecord } from "./TheRecord";
import { FPS, TOTAL } from "./theme";

/**
 * The composition length is the sum of the declared scenes, never a number
 * typed beside them — a film whose stated duration disagrees with its contents
 * is the same defect as a page whose headline disagrees with its table.
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="TheRecord"
    component={TheRecord}
    durationInFrames={TOTAL}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
