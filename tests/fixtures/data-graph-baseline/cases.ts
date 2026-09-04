import type { DataGraphBehaviorBaseline } from "./types.ts";

const CONTINUATION_READ =
  "task:119044:statement:0:relation:root.read.t03_agt_stati_info_h";
const CONTINUATION_READ_NODE = "read-occurrence:119044:0";
const CONTINUATION_DATASET =
  "dataset:hive:gfhive:pdata_n.t03_inout_agt_stati_info_h";

const ROOT_TASK = "task:root-1";
const PRODUCER_TASK = "task:shared-producer";
const SCHEDULE_TASK = "task:root-1-schedule-only";
const SHARED_DATASET = "dataset:warehouse-a:dm.shared_source";
const TOPOLOGY_BRIDGE = "edge:topology:shared-producer";

const PRODUCER_FIELD = "field:shared-producer:delta";
const READ_FIELD = "field:root-1:read:delta";
const TARGET_FIELD = "field:root-1:target:delta";
const CONTROL_NODE = "control:root-1:filter";
const FIELD_BOUNDARY = "boundary:field:precision-unavailable";
const CROSS_VALUE_EDGE = "edge:field:value:cross-delta";
const INTERNAL_VALUE_EDGE = "edge:field:value:internal-delta";
const CONTROL_EDGE = "edge:field:control:root-filter";

const EVIDENCE = {
  topologyRead: "evidence:topology:read-shared",
  topologyWrite: "evidence:topology:write-shared",
  schedule: "evidence:topology:schedule-only",
  topologyPartial: "evidence:topology:partial-source",
  fieldRead: "evidence:field:read-shared",
  fieldWrite: "evidence:field:write-shared",
  fieldCross: "evidence:field:cross-delta",
  fieldInternal: "evidence:field:internal-delta",
  fieldControl: "evidence:field:filter-control",
  fieldBoundary: "evidence:field:precision-unavailable",
  causalRoot: "evidence:causal:target-write",
  causalFieldProof: "evidence:causal:field-proof",
  causalFieldWitness: "evidence:causal:field-witness",
  causalBlocked: "evidence:causal:blocked-read",
  viewTaskName: "evidence:view:task-pack-name",
} as const;

export const DATA_GRAPH_BEHAVIOR_BASELINE = {
  source: {
    repository: "sibling scripts/data-graph",
    commit: "ece061ad62b2ff9e516970c48be8aca254601eb8",
    syntheticTestFiles: [
      {
        path: "tests/task-local-union-continuation-v2.test.ts",
        testCount: 9,
      },
      { path: "tests/project-topology.test.ts", testCount: 14 },
      { path: "tests/field-evidence-graph.test.ts", testCount: 13 },
      { path: "tests/target-causal-overlay.test.ts", testCount: 7 },
      { path: "tests/project-topology-view.test.ts", testCount: 7 },
    ],
    observedRun: {
      fileCount: 5,
      passed: 49,
      failed: 1,
      syntheticPassed: 49,
      driftProneFailure:
        "reads 119044's current envelope, not the legacy golden projection",
      statusBefore: "CLEAN",
      statusAfter: "CLEAN",
    },
  },
  continuation: {
    input: {
      consumerTaskId: "119044",
      readOccurrenceId: CONTINUATION_READ,
      readOccurrenceNodeId: CONTINUATION_READ_NODE,
      datasetNodeId: CONTINUATION_DATASET,
      readPartitionPredicate: {
        column: "busi_date",
        operator: "EQUALS",
        partitionStatus: "COMPLETE",
        valueKind: "LITERAL",
        observedValue: "2026-09-03",
        expression: null,
      },
      writes: [
        {
          taskId: "105387",
          taskCoverage: "PROJECTED",
          writeObservationId: "write-observation:105387:3",
          targetWriteNodeId: "target-write:105387:3",
          partitionPredicate: {
            column: "busi_date",
            operator: "EQUALS",
            partitionStatus: "COMPLETE",
            valueKind: "LITERAL",
            observedValue: "2026-09-03",
            expression: null,
          },
        },
        {
          taskId: "105387",
          taskCoverage: "PROJECTED",
          writeObservationId: "write-observation:105387:4",
          targetWriteNodeId: "target-write:105387:4",
          partitionPredicate: {
            column: "busi_date",
            operator: "EQUALS",
            partitionStatus: "COMPLETE",
            valueKind: "RUNTIME_EXPRESSION",
            observedValue: null,
            expression: "${YYYY-MM-DD}",
          },
        },
        {
          taskId: "105387",
          taskCoverage: "PROJECTED",
          writeObservationId: "write-observation:105387:6",
          targetWriteNodeId: "target-write:105387:6",
          partitionPredicate: {
            column: "busi_date",
            operator: "EQUALS",
            partitionStatus: "UNKNOWN",
            valueKind: "UNAVAILABLE",
            observedValue: null,
            expression: null,
          },
        },
        {
          taskId: "144289",
          taskCoverage: "PROJECTED",
          writeObservationId: "write-observation:144289:0",
          targetWriteNodeId: "target-write:144289:0",
          partitionPredicate: {
            column: "busi_date",
            operator: "EQUALS",
            partitionStatus: "COMPLETE",
            valueKind: "LITERAL",
            observedValue: "2026-09-02",
            expression: null,
          },
        },
        {
          taskId: "900001",
          taskCoverage: "SCHEDULE_ONLY",
          writeObservationId: "write-observation:900001:0",
          targetWriteNodeId: "target-write:900001:0",
          partitionPredicate: {
            column: "busi_date",
            operator: "EQUALS",
            partitionStatus: "COMPLETE",
            valueKind: "LITERAL",
            observedValue: "2026-09-03",
            expression: null,
          },
        },
        {
          taskId: "900002",
          taskCoverage: "COLLECTION_FAILED",
          writeObservationId: "write-observation:900002:0",
          targetWriteNodeId: "target-write:900002:0",
          partitionPredicate: {
            column: "busi_date",
            operator: "EQUALS",
            partitionStatus: "COMPLETE",
            valueKind: "LITERAL",
            observedValue: "2026-09-03",
            expression: null,
          },
        },
      ],
    },
    observed: {
      entryKey: `119044::${CONTINUATION_READ}`,
      candidates: [
        {
          taskId: "105387",
          readOccurrenceId: CONTINUATION_READ,
          writeObservationId: "write-observation:105387:3",
          targetWriteNodeId: "target-write:105387:3",
          partitionMatchStatus: "CONFIRMED",
          evidenceLayer: "L1",
          l1Eligible: true,
          disposition: "RETAINED",
          gapCodes: [],
        },
        {
          taskId: "105387",
          readOccurrenceId: CONTINUATION_READ,
          writeObservationId: "write-observation:105387:4",
          targetWriteNodeId: "target-write:105387:4",
          partitionMatchStatus: "ASSUMED",
          evidenceLayer: "L2",
          l1Eligible: false,
          disposition: "RETAINED",
          gapCodes: [],
        },
        {
          taskId: "105387",
          readOccurrenceId: CONTINUATION_READ,
          writeObservationId: "write-observation:105387:6",
          targetWriteNodeId: "target-write:105387:6",
          partitionMatchStatus: "UNKNOWN",
          evidenceLayer: "L2",
          l1Eligible: false,
          disposition: "RETAINED",
          gapCodes: ["WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS"],
        },
        {
          taskId: "144289",
          readOccurrenceId: CONTINUATION_READ,
          writeObservationId: "write-observation:144289:0",
          targetWriteNodeId: "target-write:144289:0",
          partitionMatchStatus: "DISJOINT",
          evidenceLayer: "L2",
          l1Eligible: false,
          disposition: "PRUNED",
          gapCodes: [],
        },
      ],
      l1WriteObservationIds: ["write-observation:105387:3"],
      excludedTaskIds: ["900001", "900002"],
    },
  },
  topology: {
    input: {
      nodes: [
        {
          nodeId: ROOT_TASK,
          nodeType: "TASK",
          label: "Root task (root-1)",
          evidenceRefs: [EVIDENCE.topologyRead],
        },
        {
          nodeId: SHARED_DATASET,
          nodeType: "PHYSICAL_DATASET",
          label: "dm.shared_source",
          evidenceRefs: [EVIDENCE.topologyRead, EVIDENCE.topologyWrite],
        },
        {
          nodeId: PRODUCER_TASK,
          nodeType: "TASK",
          label: "Shared producer (shared-producer)",
          evidenceRefs: [EVIDENCE.topologyWrite],
        },
        {
          nodeId: SCHEDULE_TASK,
          nodeType: "TASK",
          label: "Schedule-only neighbor",
          evidenceRefs: [EVIDENCE.schedule],
        },
        {
          nodeId: "boundary:topology:max-tasks",
          nodeType: "BOUNDARY",
          label: "Topology source truncated",
          evidenceRefs: [EVIDENCE.topologyPartial],
          boundaryReason: "MAX_TASKS_REACHED",
        },
      ],
      edges: [
        {
          edgeId: "edge:topology:root-reads-shared",
          edgeType: "READS_FROM",
          relationLayer: "DATA_PRODUCTION",
          fromNodeId: ROOT_TASK,
          toNodeId: SHARED_DATASET,
          evidenceRefs: [EVIDENCE.topologyRead],
          exactReadOccurrenceId: "read:shared",
        },
        {
          edgeId: TOPOLOGY_BRIDGE,
          edgeType: "PRODUCER_BRIDGE",
          relationLayer: "DATA_PRODUCTION",
          fromNodeId: SHARED_DATASET,
          toNodeId: PRODUCER_TASK,
          evidenceRefs: [EVIDENCE.topologyRead, EVIDENCE.topologyWrite],
          producerRole: "PRIMARY",
          exactReadOccurrenceId: "read:shared",
          exactWriteObservationId: null,
        },
        {
          edgeId: "edge:topology:schedule-only",
          edgeType: "SCHEDULE_DEPENDS_ON",
          relationLayer: "SCHEDULE",
          fromNodeId: ROOT_TASK,
          toNodeId: SCHEDULE_TASK,
          evidenceRefs: [EVIDENCE.schedule],
        },
      ],
      evidence: [
        { evidenceRef: EVIDENCE.topologyRead, kind: "READ_OCCURRENCE" },
        { evidenceRef: EVIDENCE.topologyWrite, kind: "PRODUCER_INDEX_WRITE" },
        { evidenceRef: EVIDENCE.schedule, kind: "SCHEDULE_REFERENCE" },
        { evidenceRef: EVIDENCE.topologyPartial, kind: "SOURCE_LIMIT" },
      ],
      sourceArtifactIds: ["artifact:multi-hop:partial-root"],
      invocations: {
        dataTrace: {
          operation: "trace",
          startNodeId: ROOT_TASK,
          direction: "OUTGOING",
          relationLayers: ["DATA_PRODUCTION"],
          maxHops: 25,
          maxNodes: 100,
          maxEdges: 200,
          maxPaths: 200,
        },
        scheduleTrace: {
          operation: "trace",
          startNodeId: ROOT_TASK,
          direction: "OUTGOING",
          relationLayers: ["SCHEDULE"],
          maxHops: 25,
          maxNodes: 100,
          maxEdges: 200,
          maxPaths: 200,
        },
        limitedGet: {
          operation: "get",
          limit: 1,
          nodeTypes: [],
          relationLayers: [],
        },
        missingTrace: {
          operation: "trace",
          startNodeId: "task:not-present",
          direction: "OUTGOING",
          relationLayers: ["DATA_PRODUCTION"],
          maxHops: 25,
          maxNodes: 100,
          maxEdges: 200,
          maxPaths: 200,
        },
        edgeExplanation: {
          operation: "explain",
          recordId: TOPOLOGY_BRIDGE,
          maxAttachments: 10,
        },
      },
    },
    observed: {
      dataTrace: {
        status: "ok",
        nodeIds: [ROOT_TASK, SHARED_DATASET, PRODUCER_TASK],
        edgeIds: ["edge:topology:root-reads-shared", TOPOLOGY_BRIDGE],
        warnings: [],
        truncated: false,
        traversalDirection: "OUTGOING",
      },
      scheduleTrace: {
        status: "ok",
        nodeIds: [ROOT_TASK, SCHEDULE_TASK],
        edgeIds: ["edge:topology:schedule-only"],
        warnings: [],
        truncated: false,
        traversalDirection: "OUTGOING",
      },
      limitedGet: {
        status: "partial",
        nodeIds: [ROOT_TASK],
        edgeIds: [],
        warnings: ["SOURCE_EVIDENCE_PARTIAL", "QUERY_LIMIT_REACHED"],
        truncated: true,
      },
      missingTrace: {
        status: "not_found",
        nodeIds: [],
        edgeIds: [],
        warnings: [],
        truncated: false,
      },
      edgeExplanation: {
        status: "partial",
        recordId: TOPOLOGY_BRIDGE,
        endpointNodeIds: [SHARED_DATASET, PRODUCER_TASK],
        evidenceRefs: [EVIDENCE.topologyRead, EVIDENCE.topologyWrite],
        attachmentRecordIds: ["artifact:multi-hop:partial-root"],
        warnings: ["SOURCE_EVIDENCE_PARTIAL"],
      },
    },
  },
  field: {
    input: {
      targetFieldNodeId: TARGET_FIELD,
      nodes: [
        {
          nodeId: PRODUCER_FIELD,
          nodeType: "FIELD_BINDING_STATE",
          label: "shared-producer.delta",
          evidenceRefs: [EVIDENCE.fieldWrite, EVIDENCE.fieldCross],
        },
        {
          nodeId: READ_FIELD,
          nodeType: "FIELD_BINDING_STATE",
          label: "root-1 read.delta",
          evidenceRefs: [EVIDENCE.fieldRead, EVIDENCE.fieldCross],
        },
        {
          nodeId: TARGET_FIELD,
          nodeType: "FIELD_BINDING_STATE",
          label: "root-1 target.delta",
          evidenceRefs: [EVIDENCE.fieldInternal],
        },
        {
          nodeId: CONTROL_NODE,
          nodeType: "DATASET_CONTROL",
          label: "root-1 FILTER",
          evidenceRefs: [EVIDENCE.fieldControl],
        },
        {
          nodeId: FIELD_BOUNDARY,
          nodeType: "BOUNDARY",
          label: "Field precision unavailable",
          evidenceRefs: [EVIDENCE.fieldBoundary],
          boundaryReason: "EVIDENCE_PRECISION_UNAVAILABLE",
        },
      ],
      edges: [
        {
          edgeId: CROSS_VALUE_EDGE,
          edgeType: "VALUE_FLOW",
          relationLayer: "VALUE",
          fromNodeId: PRODUCER_FIELD,
          toNodeId: READ_FIELD,
          evidenceRefs: [
            EVIDENCE.fieldCross,
            EVIDENCE.fieldRead,
            EVIDENCE.fieldWrite,
          ],
          exactReadOccurrenceId: "read:shared",
          exactWriteObservationId: "write:shared:0",
        },
        {
          edgeId: INTERNAL_VALUE_EDGE,
          edgeType: "VALUE_FLOW",
          relationLayer: "VALUE",
          fromNodeId: READ_FIELD,
          toNodeId: TARGET_FIELD,
          evidenceRefs: [EVIDENCE.fieldInternal],
        },
        {
          edgeId: CONTROL_EDGE,
          edgeType: "CONTROL_ANNOTATES_STATE",
          relationLayer: "ANNOTATION",
          fromNodeId: CONTROL_NODE,
          toNodeId: READ_FIELD,
          evidenceRefs: [EVIDENCE.fieldControl],
        },
        {
          edgeId: "edge:field:precision-boundary",
          edgeType: "HAS_PRECISION_BOUNDARY",
          relationLayer: "EVIDENCE_BOUNDARY",
          fromNodeId: READ_FIELD,
          toNodeId: FIELD_BOUNDARY,
          evidenceRefs: [EVIDENCE.fieldBoundary],
        },
      ],
      evidence: [
        { evidenceRef: EVIDENCE.fieldRead, kind: "READ_OCCURRENCE" },
        { evidenceRef: EVIDENCE.fieldWrite, kind: "WRITE_OBSERVATION" },
        { evidenceRef: EVIDENCE.fieldCross, kind: "FIELD_LINEAGE_EDGE" },
        { evidenceRef: EVIDENCE.fieldInternal, kind: "FIELD_LINEAGE_EDGE" },
        { evidenceRef: EVIDENCE.fieldControl, kind: "DATASET_CONTROL" },
        { evidenceRef: EVIDENCE.fieldBoundary, kind: "GAP" },
      ],
      precisionRecords: [
        {
          recordId: "precision:read:shared",
          recordType: "READ_OCCURRENCE",
          identity: "read:shared",
          evidenceRefs: [EVIDENCE.fieldRead],
        },
        {
          recordId: "precision:write:shared",
          recordType: "WRITE_OBSERVATION",
          identity: "write:shared:0",
          evidenceRefs: [EVIDENCE.fieldWrite],
        },
      ],
      invocations: {
        valueTrace: {
          operation: "trace",
          startNodeId: TARGET_FIELD,
          direction: "INCOMING_REVERSE",
          relationLayers: ["VALUE"],
          maxHops: 25,
          maxNodes: 100,
          maxEdges: 200,
          maxPaths: 200,
        },
        edgeExplanation: {
          operation: "explain",
          recordId: CROSS_VALUE_EDGE,
          maxAttachments: 10,
        },
      },
    },
    observed: {
      valueTrace: {
        status: "ok",
        nodeIds: [TARGET_FIELD, READ_FIELD, PRODUCER_FIELD],
        edgeIds: [INTERNAL_VALUE_EDGE, CROSS_VALUE_EDGE],
        annotationEdgeIds: [CONTROL_EDGE],
        warnings: [],
        truncated: false,
        traversalDirection: "INCOMING_REVERSE",
      },
      boundary: {
        coverageStatus: "PARTIAL",
        boundaryNodeId: FIELD_BOUNDARY,
        reason: "EVIDENCE_PRECISION_UNAVAILABLE",
      },
      edgeExplanation: {
        status: "ok",
        recordId: CROSS_VALUE_EDGE,
        endpointNodeIds: [PRODUCER_FIELD, READ_FIELD],
        evidenceRefs: [
          EVIDENCE.fieldCross,
          EVIDENCE.fieldRead,
          EVIDENCE.fieldWrite,
        ],
        attachmentRecordIds: [
          "precision:read:shared",
          "precision:write:shared",
        ],
        warnings: [],
      },
    },
  },
  causal: {
    input: {
      targetWriteNodeId: "target-write:fixture",
      runtimeRerunDecision: "NOT_EVALUATED",
      branches: [
        {
          branchId: "branch:root",
          producerTaskId: "root-1",
          writeObservationId: "write:root:0",
        },
        {
          branchId: "branch:confirmed",
          producerTaskId: "shared-producer",
          writeObservationId: "write:shared:0",
        },
        {
          branchId: "branch:unknown",
          producerTaskId: null,
          writeObservationId: null,
        },
      ],
      assessments: [
        {
          assessmentId: "assessment:root",
          branchId: "branch:root",
          relationStatus: "CONFIRMED_RELATED",
          channels: [],
          evidenceRefs: [EVIDENCE.causalRoot],
          gapRefs: [],
        },
        {
          assessmentId: "assessment:confirmed",
          branchId: "branch:confirmed",
          relationStatus: "CONFIRMED_RELATED",
          channels: ["FIELD_VALUE"],
          evidenceRefs: [
            EVIDENCE.causalFieldProof,
            EVIDENCE.causalFieldWitness,
          ],
          gapRefs: [],
        },
        {
          assessmentId: "assessment:unknown",
          branchId: "branch:unknown",
          relationStatus: "UNKNOWN",
          channels: ["ROW_MEMBERSHIP"],
          evidenceRefs: [],
          gapRefs: ["gap:blocked"],
        },
      ],
      gaps: [
        {
          gapId: "gap:blocked",
          reasonCode: "CAUSAL_EVIDENCE_INCOMPLETE",
          evidenceRefs: [EVIDENCE.causalBlocked],
        },
      ],
      evidence: [
        { evidenceRef: EVIDENCE.causalRoot, kind: "TARGET_WRITE" },
        { evidenceRef: EVIDENCE.causalFieldProof, kind: "FIELD_PROOF" },
        { evidenceRef: EVIDENCE.causalFieldWitness, kind: "FIELD_WITNESS" },
        { evidenceRef: EVIDENCE.causalBlocked, kind: "BLOCKED_READ" },
      ],
      invocations: {
        confirmedFilter: {
          operation: "get",
          relationStatuses: ["CONFIRMED_RELATED"],
          channels: [],
          limit: 10,
        },
        fieldValueFilter: {
          operation: "get",
          relationStatuses: [],
          channels: ["FIELD_VALUE"],
          limit: 10,
        },
        taskRollup: {
          operation: "rollup",
          taskId: "shared-producer",
          limit: 10,
        },
        gapExplanation: {
          operation: "explain",
          assessmentId: "assessment:unknown",
          maxAttachments: 10,
        },
      },
    },
    observed: {
      confirmedFilter: {
        status: "partial",
        assessmentIds: ["assessment:root", "assessment:confirmed"],
        warnings: ["RUNTIME_RERUN_NOT_EVALUATED"],
      },
      fieldValueFilter: {
        status: "partial",
        assessmentIds: ["assessment:confirmed"],
      },
      taskRollup: {
        status: "partial",
        taskId: "shared-producer",
        inMinimumCertainSet: true,
        assessmentIds: ["assessment:confirmed"],
      },
      gapExplanation: {
        status: "partial",
        assessmentId: "assessment:unknown",
        gapIds: ["gap:blocked"],
        channelCount: 1,
      },
    },
  },
  view: {
    input: {
      documents: [
        {
          recordId: PRODUCER_TASK,
          searchText: "Shared producer shared-producer dm.shared_source",
          evidenceRefs: [EVIDENCE.topologyWrite, EVIDENCE.viewTaskName],
        },
        {
          recordId: TARGET_FIELD,
          searchText: "delta root-1 target field drilldown",
          evidenceRefs: [EVIDENCE.fieldInternal, EVIDENCE.fieldCross],
        },
      ],
      evidence: [
        { evidenceRef: EVIDENCE.topologyWrite, kind: "PRODUCER_INDEX_WRITE" },
        { evidenceRef: EVIDENCE.viewTaskName, kind: "TASK_PACK_NAME" },
        { evidenceRef: EVIDENCE.fieldInternal, kind: "FIELD_LINEAGE_EDGE" },
        { evidenceRef: EVIDENCE.fieldCross, kind: "FIELD_LINEAGE_EDGE" },
      ],
      searchInvocations: [
        { query: "shared producer", limit: 20 },
        { query: "delta", limit: 20 },
      ],
      publishInvocations: [
        {
          invocationId: "publish:a:first",
          topologySnapshotId: "topology:a",
          fieldSnapshotIds: ["field:a"],
          taskPackFingerprint: "task-packs:a",
          semanticContentKey: "content:a",
          generatedAt: "2026-09-05T00:00:00.000Z",
        },
        {
          invocationId: "publish:a:repeat",
          topologySnapshotId: "topology:a",
          fieldSnapshotIds: ["field:a"],
          taskPackFingerprint: "task-packs:a",
          semanticContentKey: "content:a",
          generatedAt: "2026-09-06T00:00:00.000Z",
        },
        {
          invocationId: "publish:b:content-change",
          topologySnapshotId: "topology:a",
          fieldSnapshotIds: ["field:b"],
          taskPackFingerprint: "task-packs:a",
          semanticContentKey: "content:b",
          generatedAt: "2026-09-06T00:00:00.000Z",
        },
      ],
    },
    observed: {
      htmlMarkers: [
        "联合拓扑验收",
        'id="graph"',
        'id="fieldTaskMode"',
        'class="panel evidence-details"',
        "默认先看按任务折叠的上游链",
      ],
      searches: [
        { query: "shared producer", recordIds: [PRODUCER_TASK] },
        { query: "delta", recordIds: [TARGET_FIELD] },
      ],
      evidencePanel: {
        recordId: TARGET_FIELD,
        evidenceRefs: [EVIDENCE.fieldInternal, EVIDENCE.fieldCross],
      },
      publications: [
        {
          invocationId: "publish:a:first",
          status: "CREATED",
          viewId: "view:a",
        },
        {
          invocationId: "publish:a:repeat",
          status: "REUSED",
          viewId: "view:a",
        },
        {
          invocationId: "publish:b:content-change",
          status: "CREATED",
          viewId: "view:b",
        },
      ],
    },
  },
  fileIntegrity: {
    input: {
      tamperedFile: {
        fileName: "field-evidence.edges.jsonl",
        mutation: "REPLACE_BYTES",
      },
      tamperedManifest: {
        fileName: "projection-manifest.json",
        mutation: "REPLACE_DECLARED_HASH",
      },
      interruptedPublish: {
        interruptionPoint: "BEFORE_INSTALL",
      },
    },
    observed: {
      tamperedFileError: "FILE_HASH_OR_COUNT_INVALID",
      tamperedManifestError: "MANIFEST_HASH_INVALID",
      interruptedFinalVisible: false,
    },
  },
  scope: {
    retainedCapabilities: [
      "CONTINUATION_V2_SEMANTICS",
      "TOPOLOGY_FILE_QUERY",
      "FIELD_VALUE_FLOW_QUERY",
      "CAUSAL_EXPLANATION_QUERY",
      "STATIC_VIEW_SEARCH",
      "STATIC_VIEW_EVIDENCE_DETAILS",
    ],
    excludedCapabilities: [
      "REMOTE_GRAPH_BACKEND",
      "HISTORICAL_VERSION_READER",
      "BUSINESS_OUTCOME_CLASSIFIER",
      "FIXED_HISTORICAL_SNAPSHOT_HASH",
    ],
  },
} as const satisfies DataGraphBehaviorBaseline;
