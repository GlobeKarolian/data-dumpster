/** Below this cohesion, chronology is descriptive but not a defensible scoop claim. */
export const STORY_CONCLUSION_MIN_COHESION = 0.35;

export function storySupportsCompetitiveConclusions(
  cohesion: number,
  outletCount: number,
): boolean {
  return Number.isFinite(cohesion)
    && cohesion >= STORY_CONCLUSION_MIN_COHESION
    && outletCount > 1;
}
