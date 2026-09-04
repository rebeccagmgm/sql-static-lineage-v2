import type { CurrentBundleLoad } from "../../query/current-task-bundle.ts";
import {
  canonicalizeTaskLocalProjection,
  TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
  type TaskLocalFailureReasonCode,
  type TaskLocalProjection,
} from "./contract.ts";
import { taskNodeId } from "./ids.ts";
import type { TaskScheduleContext } from "./schedule-context.ts";

export function failureReasonFromLoad(load: CurrentBundleLoad): TaskLocalFailureReasonCode {
  if (load.issues.some((issue) => issue.startsWith("TASK_NOT_INDEXED"))) return "FACTS_UNAVAILABLE";
  if (load.issues.some((issue) => issue.startsWith("CURRENT_INDEX_MISSING"))) return "FACTS_UNAVAILABLE";
  if (load.issues.some((issue) => issue.startsWith("STATUS_OR_MANIFEST"))) return "FACTS_STALE";
  if (load.state === "INVALID") return "FACTS_INVALID";
  if (load.state === "STALE") return "FACTS_STALE";
  return "FACTS_UNAVAILABLE";
}

export function factsEvidenceStatus(
  load: CurrentBundleLoad,
): "CONFIRMED" | "PROVISIONAL_LEGACY" | null {
  if (load.state === "CURRENT_L1") return "CONFIRMED";
  if (load.state === "LEGACY_NOT_L1") return "PROVISIONAL_LEGACY";
  return null;
}

export function taskNodeProperties(input: {
  readonly packTaskName?: string | null;
  readonly schedule?: TaskScheduleContext | null;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const taskName = input.schedule?.taskName ?? input.packTaskName ?? null;
  if (taskName) properties.taskName = taskName;
  if (input.schedule?.topicName) properties.topicName = input.schedule.topicName;
  if (input.schedule) properties.scheduleReference = input.schedule.scheduleReference;
  return properties;
}

export function buildScheduleOnlyProjection(input: {
  readonly taskId: string;
  readonly generatedAt: string;
  readonly schedule: TaskScheduleContext;
}): TaskLocalProjection {
  return canonicalizeTaskLocalProjection({
    schemaVersion: TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
    artifactType: "TASK_LOCAL_PROJECTION",
    generatedAt: input.generatedAt,
    taskId: input.taskId,
    coverageStatus: "SCHEDULE_ONLY",
    failureReasonCode: null,
    nodes: [{
      nodeId: taskNodeId(input.taskId),
      nodeType: "TASK",
      properties: taskNodeProperties({ schedule: input.schedule }),
    }],
    edges: [],
    gaps: [],
  });
}

export function buildCollectionFailedProjection(input: {
  readonly taskId: string;
  readonly generatedAt: string;
  readonly failureReasonCode: TaskLocalFailureReasonCode;
  readonly taskProperties?: Readonly<Record<string, unknown>>;
}): TaskLocalProjection {
  return canonicalizeTaskLocalProjection({
    schemaVersion: TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
    artifactType: "TASK_LOCAL_PROJECTION",
    generatedAt: input.generatedAt,
    taskId: input.taskId,
    coverageStatus: "COLLECTION_FAILED",
    failureReasonCode: input.failureReasonCode,
    nodes: [{
      nodeId: taskNodeId(input.taskId),
      nodeType: "TASK",
      properties: input.taskProperties ?? {},
    }],
    edges: [],
    gaps: [],
  });
}
