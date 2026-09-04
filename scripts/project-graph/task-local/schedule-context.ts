import {
  readHoraeRelationCache,
  readHoraeTaskTypeCache,
} from "../../reconcile/consumer/one-hop/schedule-evidence-cache.ts";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function detailField(detail: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const direct = text(detail[key]);
    if (direct) return direct;
    const nested = key.split(".").reduce<unknown>(
      (current, segment) => record(current)?.[segment],
      detail,
    );
    const nestedText = text(nested);
    if (nestedText) return nestedText;
  }
  return null;
}

function neighborTaskIds(
  rows: readonly Record<string, unknown>[],
  selfTaskId: string,
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const neighborId = text(row.task_id ?? row.taskId);
    if (neighborId && neighborId !== selfTaskId) ids.add(neighborId);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export const SCHEDULE_REFERENCE_ROLE = "SCHEDULE_REFERENCE_ONLY" as const;

export interface ScheduleReference {
  readonly role: typeof SCHEDULE_REFERENCE_ROLE;
  readonly topicName: string | null;
  readonly taskName: string | null;
  readonly upstreamTaskIds: readonly string[];
  readonly downstreamTaskIds: readonly string[];
  readonly source: "schedule-evidence-cache";
  readonly observedAt: string | null;
}

export interface TaskScheduleContext {
  readonly inSchedule: boolean;
  readonly taskName: string | null;
  readonly topicName: string | null;
  readonly scheduleUpstreamTaskIds: readonly string[];
  readonly scheduleDownstreamTaskIds: readonly string[];
  readonly observedAt: string | null;
  readonly scheduleReference: ScheduleReference;
}

export function buildScheduleReference(input: {
  readonly topicName: string | null;
  readonly taskName: string | null;
  readonly upstreamTaskIds: readonly string[];
  readonly downstreamTaskIds: readonly string[];
  readonly observedAt: string | null;
}): ScheduleReference {
  return {
    role: SCHEDULE_REFERENCE_ROLE,
    topicName: input.topicName,
    taskName: input.taskName,
    upstreamTaskIds: [...input.upstreamTaskIds],
    downstreamTaskIds: [...input.downstreamTaskIds],
    source: "schedule-evidence-cache",
    observedAt: input.observedAt,
  };
}

export function readTaskScheduleContext(
  taskId: string,
  scheduleCacheRoot: string | undefined,
): TaskScheduleContext | null {
  if (!scheduleCacheRoot) return null;
  const taskType = readHoraeTaskTypeCache(taskId, scheduleCacheRoot);
  const up = readHoraeRelationCache(taskId, scheduleCacheRoot, "up");
  const down = readHoraeRelationCache(taskId, scheduleCacheRoot, "down");
  const inSchedule =
    taskType.status === "HIT" || up.status === "HIT" || down.status === "HIT";
  if (!inSchedule) return null;

  const detail = taskType.status === "HIT" ? taskType.detail : {};
  const upstreamTaskIds = up.status === "HIT" ? neighborTaskIds(up.rows, taskId) : [];
  const downstreamTaskIds = down.status === "HIT" ? neighborTaskIds(down.rows, taskId) : [];
  const observedCandidates = [
    taskType.status === "HIT" ? taskType.observedAt : null,
    up.status === "HIT" ? up.observedAt : null,
    down.status === "HIT" ? down.observedAt : null,
  ].filter((value): value is string => value !== null);
  const observedAt = observedCandidates.sort().at(-1) ?? null;
  const topicName = detailField(detail, ["topicName", "topic_name", "topic"]);
  const taskName = detailField(detail, ["taskName", "task_name", "name"]);

  return {
    inSchedule: true,
    taskName,
    topicName,
    scheduleUpstreamTaskIds: upstreamTaskIds,
    scheduleDownstreamTaskIds: downstreamTaskIds,
    observedAt,
    scheduleReference: buildScheduleReference({
      topicName,
      taskName,
      upstreamTaskIds,
      downstreamTaskIds,
      observedAt,
    }),
  };
}
