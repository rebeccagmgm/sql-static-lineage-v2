import { normalizeName } from "../../machine-facts/machine-facts-contract.ts";
import type { TaskLocalControlSide, TaskLocalJoinType } from "../task-local/contract.ts";

export type RelationRecord = Readonly<{
  readonly relationId: string;
  readonly relationType: string;
  readonly physicalDataset: string | null;
  readonly joinType: string | null;
  readonly leftRelationId: string | null;
  readonly rightRelationId: string | null;
  readonly setopBranches: readonly string[];
  readonly scopeId: string | null;
}>;

export interface RelationTreeIndex {
  readonly relations: ReadonlyMap<string, RelationRecord>;
  readonly incomingByTo: ReadonlyMap<string, readonly string[]>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function relationBody(relation: Record<string, unknown>): Record<string, unknown> {
  return record(relation.relation) ?? relation;
}

export function buildRelationTreeIndex(
  relationNodes: readonly Record<string, unknown>[],
): RelationTreeIndex {
  const relations = new Map<string, RelationRecord>();
  for (const row of relationNodes) {
    const relationId = text(row.relation_id);
    if (!relationId) continue;
    const body = relationBody(row);
    const relationType = (
      text(row.relation_type)
      ?? text(body.type)
      ?? ""
    ).toLowerCase();
    const physicalDataset = text(row.physical_dataset)
      ?? text(body.table)
      ?? text(body.physical_dataset);
    const branches = Array.isArray(body.branches)
      ? body.branches.map((value) => String(value)).filter(Boolean)
      : [];
    relations.set(relationId, {
      relationId,
      relationType,
      physicalDataset: physicalDataset ? normalizeName(physicalDataset) : null,
      joinType: text(body.join_type),
      leftRelationId: text(body.left),
      rightRelationId: text(body.right),
      setopBranches: branches,
      scopeId: text(row.scope_id) ?? text(body.scope_id),
    });
  }
  return { relations, incomingByTo: new Map() };
}

export function withIncomingRelations(
  index: RelationTreeIndex,
  relationEdges: readonly Record<string, unknown>[],
): RelationTreeIndex {
  const incomingByTo = new Map<string, string[]>();
  for (const edge of relationEdges) {
    const to = text(edge.to_relation_id);
    const from = text(edge.from_relation_id);
    if (!to || !from) continue;
    const values = incomingByTo.get(to) ?? [];
    values.push(from);
    incomingByTo.set(to, values);
  }
  return { ...index, incomingByTo };
}

export function relationSubtree(
  index: RelationTreeIndex,
  rootRelationId: string,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const stack = [rootRelationId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of index.incomingByTo.get(current) ?? []) {
      if (!visited.has(parent)) stack.push(parent);
    }
  }
  return visited;
}

export function subtreeContains(
  index: RelationTreeIndex,
  ancestorRelationId: string,
  descendantRelationId: string,
): boolean {
  return relationSubtree(index, ancestorRelationId).has(descendantRelationId);
}

export function readRelationsInSubtree(
  index: RelationTreeIndex,
  rootRelationId: string,
): readonly RelationRecord[] {
  const subtree = relationSubtree(index, rootRelationId);
  return [...subtree]
    .map((relationId) => index.relations.get(relationId))
    .filter((relation): relation is RelationRecord =>
      relation !== undefined && relation.relationType === "read",
    )
    .sort((left, right) => left.relationId.localeCompare(right.relationId));
}

export function nearestSetopAncestor(
  index: RelationTreeIndex,
  relationId: string,
): RelationRecord | null {
  const visited = new Set<string>();
  let current: string | null = relationId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const relation = index.relations.get(current);
    if (relation?.relationType === "setop") return relation;
    const parents: readonly string[] = index.incomingByTo.get(current) ?? [];
    current = parents.length === 1 ? parents[0]! : null;
  }
  return null;
}

export function normalizeJoinType(joinType: string | null): TaskLocalJoinType {
  const kind = (joinType ?? "").trim().toUpperCase();
  if (kind.includes("INNER")) return "INNER";
  if (kind.includes("LEFT")) return "LEFT";
  if (kind.includes("RIGHT")) return "RIGHT";
  if (kind.includes("FULL")) return "FULL";
  if (kind.includes("CROSS")) return "CROSS";
  return "N/A";
}

export function controlSideForJoin(input: {
  readonly index: RelationTreeIndex;
  readonly joinRelation: RelationRecord;
  readonly controlReadRelationId: string | null;
}): TaskLocalControlSide {
  const { index, joinRelation, controlReadRelationId } = input;
  if (!controlReadRelationId || !joinRelation.leftRelationId || !joinRelation.rightRelationId) {
    return "BOTH";
  }
  const inLeft = subtreeContains(index, joinRelation.leftRelationId, controlReadRelationId);
  const inRight = subtreeContains(index, joinRelation.rightRelationId, controlReadRelationId);
  if (inLeft && !inRight) return "LEFT";
  if (inRight && !inLeft) return "RIGHT";
  return "BOTH";
}
