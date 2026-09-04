import {
  scheduleParentAmbiguousGap,
  type HoraeScheduleRelationLookup,
} from "../schedule-preference.ts";
import type { ContinuationPolicy } from "./policy.ts";
import type { ContinuationCandidate } from "./types.ts";
import { withContinuationCandidate } from "./types.ts";

export function directParentTaskIdsForCandidates(input: {
  readonly consumerTaskId: string;
  readonly candidates: readonly ContinuationCandidate[];
  readonly lookup: HoraeScheduleRelationLookup | null;
}): readonly string[] {
  if (!input.lookup) return [];
  if (input.lookup.statusFor(input.consumerTaskId) !== "AVAILABLE") return [];
  return input.candidates
    .filter((candidate) =>
      candidate.index.taskId !== input.consumerTaskId
      && input.lookup!.isDirectParent(input.consumerTaskId, candidate.index.taskId),
    )
    .map((candidate) => candidate.index.taskId)
    .sort((left, right) => left.localeCompare(right));
}

export function reduceContinuationCandidates(input: {
  readonly consumerTaskId: string;
  readonly readOccurrenceId: string;
  readonly column: string;
  readonly candidates: readonly ContinuationCandidate[];
  readonly policy: ContinuationPolicy;
  readonly scheduleLookup: HoraeScheduleRelationLookup | null;
}): {
  readonly candidates: readonly ContinuationCandidate[];
  readonly scheduleParentAmbiguous: boolean;
} {
  const pruned = input.candidates.filter(
    (candidate) => !input.policy.pruneOn.includes(candidate.partitionOverlap),
  );

  const directParents = directParentTaskIdsForCandidates({
    consumerTaskId: input.consumerTaskId,
    candidates: pruned,
    lookup: input.scheduleLookup,
  });
  const scheduleParentAmbiguous = directParents.length > 1;

  const candidates = pruned.map((candidate) => {
    const overlapEligible = input.policy.confirmOn.includes(
      candidate.partitionOverlap,
    );
    const eligible = !scheduleParentAmbiguous && overlapEligible;
    return withContinuationCandidate(candidate, {
      continuationEligible: eligible,
      ruleId: "CONTINUATION_REDUCE",
    });
  });

  return { candidates, scheduleParentAmbiguous };
}

export function scheduleAmbiguousGapForPipeline(input: {
  readonly consumerTaskId: string;
  readonly readOccurrenceId: string;
  readonly column: string;
  readonly directParentTaskIds: readonly string[];
}) {
  return scheduleParentAmbiguousGap(input);
}
