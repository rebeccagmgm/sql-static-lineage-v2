import { describe, expect, it } from "vitest";

import { proveReadOccurrence } from "../../scripts/machine-facts/read-occurrence-proof.ts";
import type { CurrentBundleLoad, JsonRecord } from "../../scripts/query/current-task-bundle.ts";

function load(taskId: string, records: Record<string, JsonRecord[]>): CurrentBundleLoad {
  return {
    state: "CURRENT_L1",
    factsRoot: "facts",
    taskId,
    bundleDir: "",
    indexPath: "",
    statusPath: "",
    records,
    evidence: {},
    issues: [],
  };
}

const table = { qualifiedName: "odata_n_tit.d_pos_position_daily" };
const b0 = "root.t.setop.b0.read.d_pos_position_daily";
const b1 = "root.t.setop.b1.a.read.d_pos_position_daily";
const statementId = "task:106590:slot:query:statement:0";

function unionFacts(extra: Record<string, JsonRecord[]> = {}): CurrentBundleLoad {
  return load("106590", {
    "statements.jsonl": [{ statement_id: statementId, statement_index: 0 }],
    "relation-nodes.jsonl": [
      {
        task_id: "106590",
        relation_id: b0,
        relation_type: "read",
        statement_id: statementId,
        read_occurrence_id: b0,
        relation: { type: "read", table: table.qualifiedName, id: b0, read_occurrence_id: b0 },
      },
      {
        task_id: "106590",
        relation_id: b1,
        relation_type: "read",
        statement_id: statementId,
        read_occurrence_id: b1,
        relation: { type: "read", table: table.qualifiedName, id: b1, read_occurrence_id: b1 },
      },
    ],
    "dataset-io.jsonl": [
      {
        direction: "READ",
        task_id: "106590",
        physical_dataset: table.qualifiedName,
        statement_id: statementId,
        read_occurrences: [
          { occurrence_id: b0, relation_id: b0 },
          { occurrence_id: b1, relation_id: b1 },
        ],
      },
    ],
    ...extra,
  });
}

describe("proveReadOccurrence", () => {
  it("proves a query# occurrence against a local UNION-branch relation id", () => {
    const proof = proveReadOccurrence(unionFacts(), table, {
      occurrenceId: `query#0:${b0}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(proof.valid).toBe(true);
    expect(proof.relationId).toBe(b0);
  });

  it("does not prove setop.b1 with a setop.b0 occurrence", () => {
    const proof = proveReadOccurrence(unionFacts(), table, {
      occurrenceId: `query#0:${b0}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(proof.valid).toBe(true);
    const other = proveReadOccurrence(unionFacts(), table, {
      occurrenceId: `query#0:${b1}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(other.valid).toBe(false);
    expect(other.reason).toBe("CONSUMER_READ_OCCURRENCE_NOT_PROVEN");
  });

  it("hard-fails when an occurrence id is present but disagrees", () => {
    const facts = load("106590", {
      "statements.jsonl": [{ statement_id: statementId, statement_index: 0 }],
      "relation-nodes.jsonl": [
        {
          task_id: "106590",
          relation_id: b0,
          relation_type: "read",
          statement_id: statementId,
          read_occurrence_id: b0,
          relation: {
            type: "read",
            table: table.qualifiedName,
            id: b0,
            read_occurrence_id: b0,
            binding: "b0",
            scope_id: "root.t.setop.b0",
          },
        },
      ],
      "dataset-io.jsonl": [
        {
          direction: "READ",
          task_id: "106590",
          physical_dataset: table.qualifiedName,
          statement_id: statementId,
          read_occurrences: [{ occurrence_id: b0, relation_id: b0 }],
        },
      ],
    });
    const proof = proveReadOccurrence(facts, table, {
      occurrenceId: `query#0:${b1}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(proof.valid).toBe(false);
  });

  it("allows legacy binding/scope only when the node has no occurrence id", () => {
    const facts = load("106590", {
      "statements.jsonl": [{ statement_id: statementId, statement_index: 0 }],
      "relation-nodes.jsonl": [
        {
          task_id: "106590",
          relation_id: b0,
          relation_type: "read",
          statement_id: statementId,
          relation: {
            type: "read",
            table: table.qualifiedName,
            id: b0,
            binding: "b0",
            scope_id: "root.t.setop.b0",
          },
        },
      ],
      "dataset-io.jsonl": [
        {
          direction: "READ",
          task_id: "106590",
          physical_dataset: table.qualifiedName,
          statement_id: statementId,
        },
      ],
    });
    const proof = proveReadOccurrence(facts, table, {
      occurrenceId: `query#0:${b0}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(proof.valid).toBe(true);
  });

  it("rejects repeated same-table reads when dataset-io has no occurrence list", () => {
    const facts = load("106590", {
      "statements.jsonl": [{ statement_id: statementId, statement_index: 0 }],
      "relation-nodes.jsonl": [
        {
          task_id: "106590",
          relation_id: b0,
          relation_type: "read",
          statement_id: statementId,
          read_occurrence_id: b0,
          relation: { type: "read", table: table.qualifiedName, id: b0, read_occurrence_id: b0 },
        },
      ],
      "dataset-io.jsonl": [
        {
          direction: "READ",
          task_id: "106590",
          physical_dataset: table.qualifiedName,
          statement_id: statementId,
        },
        {
          direction: "READ",
          task_id: "106590",
          physical_dataset: table.qualifiedName,
          statement_id: statementId,
        },
      ],
    });
    const proof = proveReadOccurrence(facts, table, {
      occurrenceId: `query#0:${b0}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(proof.valid).toBe(false);
    expect(proof.reason).toBe("CONSUMER_READ_OCCURRENCE_NOT_PROVEN");
  });

  it("skips proof when the caller did not load relation-nodes", () => {
    const facts = load("106590", {});
    const proof = proveReadOccurrence(facts, table, {
      occurrenceId: `query#0:${b0}`,
      readRelationId: b0,
      statementIndex: 0,
      relationPath: [b0],
    });
    expect(proof.valid).toBe(true);
    expect(proof.relationId).toBeNull();
  });
});
