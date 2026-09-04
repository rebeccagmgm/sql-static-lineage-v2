import { describe, expect, it } from "vitest";

import { DATA_GRAPH_BEHAVIOR_BASELINE } from "../fixtures/data-graph-baseline/cases.ts";

describe("frozen data-graph behavior vectors", () => {
  it("records the real synthetic source run without treating artifact drift as a baseline", () => {
    const { source } = DATA_GRAPH_BEHAVIOR_BASELINE;

    expect(source.commit).toBe("ece061ad62b2ff9e516970c48be8aca254601eb8");
    expect(source.syntheticTestFiles).toHaveLength(5);
    expect(
      source.syntheticTestFiles.reduce(
        (total, file) => total + file.testCount,
        0,
      ),
    ).toBe(50);
    expect(source.observedRun).toEqual({
      fileCount: 5,
      passed: 49,
      failed: 1,
      syntheticPassed: 49,
      driftProneFailure:
        "reads 119044's current envelope, not the legacy golden projection",
      statusBefore: "CLEAN",
      statusAfter: "CLEAN",
    });
  });

  it("preserves exact continuation occurrences, four partition states, and the L1 gate", () => {
    const { input, observed } = DATA_GRAPH_BEHAVIOR_BASELINE.continuation;
    const writesById = new Map(
      input.writes.map((write) => [write.writeObservationId, write]),
    );

    expect(observed.entryKey).toBe(
      `${input.consumerTaskId}::${input.readOccurrenceId}`,
    );
    expect(
      observed.candidates
        .map(({ partitionMatchStatus }) => partitionMatchStatus)
        .sort(),
    ).toEqual(["ASSUMED", "CONFIRMED", "DISJOINT", "UNKNOWN"]);
    expect(input.readPartitionPredicate).toEqual({
      column: "busi_date",
      operator: "EQUALS",
      partitionStatus: "COMPLETE",
      valueKind: "LITERAL",
      observedValue: "2026-09-03",
      expression: null,
    });

    for (const candidate of observed.candidates) {
      const sourceWrite = writesById.get(candidate.writeObservationId);
      expect(sourceWrite, candidate.writeObservationId).toBeDefined();
      expect(candidate.readOccurrenceId).toBe(input.readOccurrenceId);
      expect(candidate.taskId).toBe(sourceWrite?.taskId);
      expect(candidate.targetWriteNodeId).toBe(sourceWrite?.targetWriteNodeId);
      expect(sourceWrite?.taskCoverage).toBe("PROJECTED");
      expect(candidate.l1Eligible).toBe(
        candidate.partitionMatchStatus === "CONFIRMED",
      );
      expect(candidate.evidenceLayer).toBe(candidate.l1Eligible ? "L1" : "L2");

      const writePredicate = sourceWrite?.partitionPredicate;
      expect(writePredicate?.column).toBe(input.readPartitionPredicate.column);
      expect(writePredicate?.operator).toBe(
        input.readPartitionPredicate.operator,
      );
      if (candidate.partitionMatchStatus === "CONFIRMED") {
        expect(writePredicate).toMatchObject({
          partitionStatus: "COMPLETE",
          valueKind: "LITERAL",
          observedValue: input.readPartitionPredicate.observedValue,
        });
      } else if (candidate.partitionMatchStatus === "ASSUMED") {
        expect(writePredicate).toMatchObject({
          partitionStatus: "COMPLETE",
          valueKind: "RUNTIME_EXPRESSION",
          observedValue: null,
          expression: "${YYYY-MM-DD}",
        });
      } else if (candidate.partitionMatchStatus === "UNKNOWN") {
        expect(writePredicate).toMatchObject({
          partitionStatus: "UNKNOWN",
          valueKind: "UNAVAILABLE",
          observedValue: null,
          expression: null,
        });
      } else {
        expect(writePredicate).toMatchObject({
          partitionStatus: "COMPLETE",
          valueKind: "LITERAL",
        });
        expect(writePredicate?.observedValue).not.toBe(
          input.readPartitionPredicate.observedValue,
        );
      }
    }

    expect(
      observed.candidates
        .filter(({ l1Eligible }) => l1Eligible)
        .map(({ writeObservationId }) => writeObservationId),
    ).toEqual(observed.l1WriteObservationIds);
    expect(
      observed.candidates.find(
        ({ partitionMatchStatus }) => partitionMatchStatus === "UNKNOWN",
      ),
    ).toMatchObject({
      l1Eligible: false,
      gapCodes: ["WRITE_OBSERVATION_ALIGNMENT_AMBIGUOUS"],
    });
    expect(
      observed.candidates.find(
        ({ partitionMatchStatus }) => partitionMatchStatus === "DISJOINT",
      )?.disposition,
    ).toBe("PRUNED");

    const sameTaskWrites = observed.candidates
      .filter(({ taskId }) => taskId === "105387")
      .map(({ writeObservationId }) => writeObservationId);
    expect(new Set(sameTaskWrites).size).toBe(3);
    expect(sameTaskWrites).not.toContain("write-observation:105387:0");
    expect(
      input.writes
        .filter(({ taskCoverage }) => taskCoverage !== "PROJECTED")
        .map(({ taskId }) => taskId),
    ).toEqual(observed.excludedTaskIds);
    for (const excludedTaskId of observed.excludedTaskIds) {
      expect(observed.candidates.map(({ taskId }) => taskId)).not.toContain(
        excludedTaskId,
      );
    }
  });

  it("freezes topology data/schedule isolation, limits, not-found, and explain", () => {
    const { input, observed } = DATA_GRAPH_BEHAVIOR_BASELINE.topology;
    const nodesById = new Map<string, (typeof input.nodes)[number]>(
      input.nodes.map((node) => [node.nodeId, node]),
    );
    const edgesById = new Map(input.edges.map((edge) => [edge.edgeId, edge]));
    const evidenceRefs = new Set(
      input.evidence.map(({ evidenceRef }) => evidenceRef),
    );

    for (const node of input.nodes) {
      for (const evidenceRef of node.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
    }
    for (const edge of input.edges) {
      expect(nodesById.has(edge.fromNodeId), edge.edgeId).toBe(true);
      expect(nodesById.has(edge.toNodeId), edge.edgeId).toBe(true);
      for (const evidenceRef of edge.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
    }
    for (const trace of [
      observed.dataTrace,
      observed.scheduleTrace,
      observed.limitedGet,
      observed.missingTrace,
    ]) {
      for (const nodeId of trace.nodeIds) {
        expect(nodesById.has(nodeId), nodeId).toBe(true);
      }
      for (const edgeId of trace.edgeIds) {
        expect(edgesById.has(edgeId), edgeId).toBe(true);
      }
    }

    expect(input.invocations.dataTrace).toMatchObject({
      operation: "trace",
      startNodeId: "task:root-1",
      direction: "OUTGOING",
      relationLayers: ["DATA_PRODUCTION"],
      maxHops: 25,
      maxNodes: 100,
      maxEdges: 200,
      maxPaths: 200,
    });
    expect(nodesById.has(input.invocations.dataTrace.startNodeId)).toBe(true);
    expect(observed.dataTrace.nodeIds[0]).toBe(
      input.invocations.dataTrace.startNodeId,
    );
    expect(observed.dataTrace.traversalDirection).toBe(
      input.invocations.dataTrace.direction,
    );

    expect(observed.dataTrace).toMatchObject({
      status: "ok",
      traversalDirection: "OUTGOING",
      truncated: false,
      warnings: [],
    });
    expect(observed.dataTrace.nodeIds).toContain("task:shared-producer");
    expect(observed.dataTrace.nodeIds).not.toContain(
      "task:root-1-schedule-only",
    );
    expect(
      observed.dataTrace.edgeIds.map(
        (edgeId) => edgesById.get(edgeId)?.relationLayer,
      ),
    ).toEqual(["DATA_PRODUCTION", "DATA_PRODUCTION"]);
    expect(
      new Set(
        observed.dataTrace.edgeIds.map(
          (edgeId) => edgesById.get(edgeId)?.relationLayer,
        ),
      ),
    ).toEqual(new Set(input.invocations.dataTrace.relationLayers));

    expect(input.invocations.scheduleTrace).toMatchObject({
      operation: "trace",
      startNodeId: "task:root-1",
      direction: "OUTGOING",
      relationLayers: ["SCHEDULE"],
      maxHops: 25,
      maxNodes: 100,
      maxEdges: 200,
      maxPaths: 200,
    });
    expect(observed.scheduleTrace).toMatchObject({
      status: "ok",
      traversalDirection: "OUTGOING",
      truncated: false,
    });
    expect(observed.scheduleTrace.nodeIds).toContain(
      "task:root-1-schedule-only",
    );
    expect(observed.scheduleTrace.nodeIds).not.toContain(
      "task:shared-producer",
    );
    expect(
      observed.scheduleTrace.edgeIds.map(
        (edgeId) => edgesById.get(edgeId)?.relationLayer,
      ),
    ).toEqual(["SCHEDULE"]);
    expect(observed.scheduleTrace.nodeIds[0]).toBe(
      input.invocations.scheduleTrace.startNodeId,
    );
    expect(observed.scheduleTrace.traversalDirection).toBe(
      input.invocations.scheduleTrace.direction,
    );

    expect(input.invocations.limitedGet).toEqual({
      operation: "get",
      limit: 1,
      nodeTypes: [],
      relationLayers: [],
    });
    expect(observed.limitedGet).toMatchObject({
      status: "partial",
      warnings: ["SOURCE_EVIDENCE_PARTIAL", "QUERY_LIMIT_REACHED"],
      truncated: true,
    });
    expect(observed.limitedGet.nodeIds.length).toBeLessThanOrEqual(
      input.invocations.limitedGet.limit,
    );
    expect(input.invocations.missingTrace).toEqual({
      operation: "trace",
      startNodeId: "task:not-present",
      direction: "OUTGOING",
      relationLayers: ["DATA_PRODUCTION"],
      maxHops: 25,
      maxNodes: 100,
      maxEdges: 200,
      maxPaths: 200,
    });
    expect(nodesById.has(input.invocations.missingTrace.startNodeId)).toBe(
      false,
    );
    expect(observed.missingTrace).toEqual({
      status: "not_found",
      nodeIds: [],
      edgeIds: [],
      warnings: [],
      truncated: false,
    });
    expect(
      input.nodes.find(({ nodeType }) => nodeType === "BOUNDARY"),
    ).toMatchObject({ boundaryReason: "MAX_TASKS_REACHED" });

    const explainedEdge = edgesById.get(observed.edgeExplanation.recordId);
    expect(input.invocations.edgeExplanation).toEqual({
      operation: "explain",
      recordId: observed.edgeExplanation.recordId,
      maxAttachments: 10,
    });
    expect(observed.edgeExplanation.status).toBe("partial");
    expect(observed.edgeExplanation.endpointNodeIds).toEqual([
      explainedEdge?.fromNodeId,
      explainedEdge?.toNodeId,
    ]);
    expect(observed.edgeExplanation.evidenceRefs).toEqual(
      explainedEdge?.evidenceRefs,
    );
    expect(explainedEdge).toMatchObject({
      producerRole: "PRIMARY",
      exactWriteObservationId: null,
    });
    expect(
      observed.edgeExplanation.attachmentRecordIds.length,
    ).toBeLessThanOrEqual(input.invocations.edgeExplanation.maxAttachments);
    for (const attachment of observed.edgeExplanation.attachmentRecordIds) {
      expect(input.sourceArtifactIds).toContain(attachment);
    }
  });

  it("freezes producer-to-target VALUE_FLOW, annotations, boundary, and explain", () => {
    const { input, observed } = DATA_GRAPH_BEHAVIOR_BASELINE.field;
    const nodesById = new Map(input.nodes.map((node) => [node.nodeId, node]));
    const edgesById = new Map(input.edges.map((edge) => [edge.edgeId, edge]));
    const evidenceRefs = new Set(
      input.evidence.map(({ evidenceRef }) => evidenceRef),
    );
    const precisionById = new Map(
      input.precisionRecords.map((record) => [record.recordId, record]),
    );

    for (const node of input.nodes) {
      for (const evidenceRef of node.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
    }
    for (const edge of input.edges) {
      expect(nodesById.has(edge.fromNodeId), edge.edgeId).toBe(true);
      expect(nodesById.has(edge.toNodeId), edge.edgeId).toBe(true);
      for (const evidenceRef of edge.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
    }
    for (const nodeId of observed.valueTrace.nodeIds) {
      expect(nodesById.has(nodeId), nodeId).toBe(true);
    }
    for (const edgeId of [
      ...observed.valueTrace.edgeIds,
      ...observed.valueTrace.annotationEdgeIds,
    ]) {
      expect(edgesById.has(edgeId), edgeId).toBe(true);
    }

    expect(input.invocations.valueTrace).toEqual({
      operation: "trace",
      startNodeId: input.targetFieldNodeId,
      direction: "INCOMING_REVERSE",
      relationLayers: ["VALUE"],
      maxHops: 25,
      maxNodes: 100,
      maxEdges: 200,
      maxPaths: 200,
    });
    expect(nodesById.has(input.invocations.valueTrace.startNodeId)).toBe(true);
    expect(observed.valueTrace.nodeIds[0]).toBe(
      input.invocations.valueTrace.startNodeId,
    );
    expect(observed.valueTrace.traversalDirection).toBe(
      input.invocations.valueTrace.direction,
    );

    expect(edgesById.get("edge:field:value:cross-delta")).toMatchObject({
      edgeType: "VALUE_FLOW",
      fromNodeId: "field:shared-producer:delta",
      toNodeId: "field:root-1:read:delta",
      exactReadOccurrenceId: "read:shared",
      exactWriteObservationId: "write:shared:0",
    });
    expect(edgesById.get("edge:field:value:internal-delta")).toMatchObject({
      edgeType: "VALUE_FLOW",
      fromNodeId: "field:root-1:read:delta",
      toNodeId: "field:root-1:target:delta",
    });
    expect(observed.valueTrace).toMatchObject({
      status: "ok",
      traversalDirection: "INCOMING_REVERSE",
      nodeIds: [
        "field:root-1:target:delta",
        "field:root-1:read:delta",
        "field:shared-producer:delta",
      ],
      edgeIds: [
        "edge:field:value:internal-delta",
        "edge:field:value:cross-delta",
      ],
      annotationEdgeIds: ["edge:field:control:root-filter"],
      truncated: false,
    });
    expect(
      observed.valueTrace.edgeIds.map(
        (edgeId) => edgesById.get(edgeId)?.edgeType,
      ),
    ).toEqual(["VALUE_FLOW", "VALUE_FLOW"]);
    expect(
      observed.valueTrace.annotationEdgeIds.map(
        (edgeId) => edgesById.get(edgeId)?.relationLayer,
      ),
    ).toEqual(["ANNOTATION"]);

    const boundaryNode = nodesById.get(observed.boundary.boundaryNodeId);
    expect(observed.boundary.coverageStatus).toBe("PARTIAL");
    expect(
      boundaryNode && "boundaryReason" in boundaryNode
        ? boundaryNode.boundaryReason
        : null,
    ).toBe(observed.boundary.reason);

    const explainedEdge = edgesById.get(observed.edgeExplanation.recordId);
    expect(input.invocations.edgeExplanation).toEqual({
      operation: "explain",
      recordId: observed.edgeExplanation.recordId,
      maxAttachments: 10,
    });
    expect(observed.edgeExplanation).toMatchObject({
      status: "ok",
      endpointNodeIds: [
        "field:shared-producer:delta",
        "field:root-1:read:delta",
      ],
      warnings: [],
    });
    expect(observed.edgeExplanation.evidenceRefs).toEqual(
      explainedEdge?.evidenceRefs,
    );
    expect(
      observed.edgeExplanation.attachmentRecordIds.length,
    ).toBeLessThanOrEqual(input.invocations.edgeExplanation.maxAttachments);
    expect(
      observed.edgeExplanation.attachmentRecordIds.map(
        (recordId) => precisionById.get(recordId)?.recordType,
      ),
    ).toEqual(["READ_OCCURRENCE", "WRITE_OBSERVATION"]);
    expect(
      new Set(input.precisionRecords.flatMap(({ evidenceRefs: refs }) => refs)),
    ).toEqual(
      new Set(["evidence:field:read-shared", "evidence:field:write-shared"]),
    );
  });

  it("freezes causal filters, task rollup, and named-gap explanation", () => {
    const { input, observed } = DATA_GRAPH_BEHAVIOR_BASELINE.causal;
    const branchesById = new Map(
      input.branches.map((branch) => [branch.branchId, branch]),
    );
    const assessmentsById = new Map(
      input.assessments.map((assessment) => [
        assessment.assessmentId,
        assessment,
      ]),
    );
    const gapsById = new Map(input.gaps.map((gap) => [gap.gapId, gap]));
    const evidenceRefs = new Set(
      input.evidence.map(({ evidenceRef }) => evidenceRef),
    );

    for (const assessment of input.assessments) {
      expect(branchesById.has(assessment.branchId), assessment.branchId).toBe(
        true,
      );
      for (const evidenceRef of assessment.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
      for (const gapRef of assessment.gapRefs) {
        expect(gapsById.has(gapRef), gapRef).toBe(true);
      }
    }
    for (const gap of input.gaps) {
      for (const evidenceRef of gap.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
    }

    expect(observed.confirmedFilter).toMatchObject({
      status: "partial",
      warnings: ["RUNTIME_RERUN_NOT_EVALUATED"],
    });
    expect(input.invocations.confirmedFilter).toEqual({
      operation: "get",
      relationStatuses: ["CONFIRMED_RELATED"],
      channels: [],
      limit: 10,
    });
    expect(input.runtimeRerunDecision).toBe("NOT_EVALUATED");
    for (const assessmentId of observed.confirmedFilter.assessmentIds) {
      expect(input.invocations.confirmedFilter.relationStatuses).toContain(
        assessmentsById.get(assessmentId)?.relationStatus,
      );
    }
    expect(observed.confirmedFilter.assessmentIds.length).toBeLessThanOrEqual(
      input.invocations.confirmedFilter.limit,
    );
    expect(input.invocations.fieldValueFilter).toEqual({
      operation: "get",
      relationStatuses: [],
      channels: ["FIELD_VALUE"],
      limit: 10,
    });
    for (const assessmentId of observed.fieldValueFilter.assessmentIds) {
      for (const channel of input.invocations.fieldValueFilter.channels) {
        expect(assessmentsById.get(assessmentId)?.channels).toContain(channel);
      }
    }

    expect(observed.taskRollup).toMatchObject({
      status: "partial",
      taskId: "shared-producer",
      inMinimumCertainSet: true,
      assessmentIds: ["assessment:confirmed"],
    });
    expect(input.invocations.taskRollup).toEqual({
      operation: "rollup",
      taskId: observed.taskRollup.taskId,
      limit: 10,
    });
    expect(observed.taskRollup.assessmentIds.length).toBeLessThanOrEqual(
      input.invocations.taskRollup.limit,
    );
    const rollupAssessment = assessmentsById.get(
      observed.taskRollup.assessmentIds[0],
    );
    expect(rollupAssessment).toBeDefined();
    const rollupBranch = rollupAssessment
      ? branchesById.get(rollupAssessment.branchId)
      : undefined;
    expect(rollupBranch?.producerTaskId).toBe(observed.taskRollup.taskId);

    const explainedAssessment = assessmentsById.get(
      observed.gapExplanation.assessmentId,
    );
    expect(input.invocations.gapExplanation).toEqual({
      operation: "explain",
      assessmentId: observed.gapExplanation.assessmentId,
      maxAttachments: 10,
    });
    expect(observed.gapExplanation).toMatchObject({
      status: "partial",
      channelCount: 1,
    });
    expect(explainedAssessment?.relationStatus).toBe("UNKNOWN");
    expect(explainedAssessment?.gapRefs).toEqual(
      observed.gapExplanation.gapIds,
    );
    expect(observed.gapExplanation.gapIds.length).toBeLessThanOrEqual(
      input.invocations.gapExplanation.maxAttachments,
    );
    expect(
      observed.gapExplanation.gapIds.map(
        (gapId) => gapsById.get(gapId)?.reasonCode,
      ),
    ).toEqual(["CAUSAL_EVIDENCE_INCOMPLETE"]);
  });

  it("freezes static view markers, search, evidence, reuse, and content change", () => {
    const { input, observed } = DATA_GRAPH_BEHAVIOR_BASELINE.view;
    const documentsById = new Map(
      input.documents.map((document) => [document.recordId, document]),
    );
    const evidenceRefs = new Set(
      input.evidence.map(({ evidenceRef }) => evidenceRef),
    );
    const searchInvocationsByQuery = new Map(
      input.searchInvocations.map((invocation) => [
        invocation.query,
        invocation,
      ]),
    );
    const publishInvocationsById = new Map(
      input.publishInvocations.map((invocation) => [
        invocation.invocationId,
        invocation,
      ]),
    );

    for (const document of input.documents) {
      for (const evidenceRef of document.evidenceRefs) {
        expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
      }
    }
    expect(observed.htmlMarkers).toEqual(
      expect.arrayContaining([
        "联合拓扑验收",
        'id="graph"',
        'id="fieldTaskMode"',
        'class="panel evidence-details"',
        "默认先看按任务折叠的上游链",
      ]),
    );
    for (const search of observed.searches) {
      const invocation = searchInvocationsByQuery.get(search.query);
      expect(invocation, search.query).toBeDefined();
      expect(search.recordIds.length).toBeLessThanOrEqual(
        invocation?.limit ?? 0,
      );
      for (const recordId of search.recordIds) {
        const document = documentsById.get(recordId);
        expect(document, recordId).toBeDefined();
        expect(document?.searchText.toLowerCase()).toContain(
          search.query.toLowerCase(),
        );
      }
    }

    const evidenceDocument = documentsById.get(observed.evidencePanel.recordId);
    expect(evidenceDocument?.evidenceRefs).toEqual(
      observed.evidencePanel.evidenceRefs,
    );
    for (const evidenceRef of observed.evidencePanel.evidenceRefs) {
      expect(evidenceRefs.has(evidenceRef), evidenceRef).toBe(true);
    }

    const [created, reused, changed] = observed.publications;
    expect([created.status, reused.status, changed.status]).toEqual([
      "CREATED",
      "REUSED",
      "CREATED",
    ]);
    const createdInput = publishInvocationsById.get(created.invocationId);
    const reusedInput = publishInvocationsById.get(reused.invocationId);
    const changedInput = publishInvocationsById.get(changed.invocationId);
    expect(createdInput).toBeDefined();
    expect(reusedInput).toMatchObject({
      topologySnapshotId: createdInput?.topologySnapshotId,
      fieldSnapshotIds: createdInput?.fieldSnapshotIds,
      taskPackFingerprint: createdInput?.taskPackFingerprint,
      semanticContentKey: createdInput?.semanticContentKey,
    });
    expect(reusedInput?.generatedAt).not.toBe(createdInput?.generatedAt);
    expect(reused.viewId).toBe(created.viewId);
    expect(changedInput?.semanticContentKey).not.toBe(
      createdInput?.semanticContentKey,
    );
    expect(changedInput?.fieldSnapshotIds).not.toEqual(
      createdInput?.fieldSnapshotIds,
    );
    expect(changed.viewId).not.toBe(created.viewId);
  });

  it("freezes file-integrity failures and excludes retired implementation concerns", () => {
    const { fileIntegrity, scope } = DATA_GRAPH_BEHAVIOR_BASELINE;

    expect(fileIntegrity.input).toEqual({
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
    });
    expect(fileIntegrity.observed).toEqual({
      tamperedFileError: "FILE_HASH_OR_COUNT_INVALID",
      tamperedManifestError: "MANIFEST_HASH_INVALID",
      interruptedFinalVisible: false,
    });
    expect(
      scope.retainedCapabilities.filter((capability) =>
        scope.excludedCapabilities.includes(
          capability as (typeof scope.excludedCapabilities)[number],
        ),
      ),
    ).toEqual([]);

    const serialized = JSON.stringify(DATA_GRAPH_BEHAVIOR_BASELINE);
    expect(serialized).not.toMatch(/\b[a-f0-9]{64}\b/);
    expect(serialized.toLowerCase()).not.toContain("neo4j");
    expect(serialized).not.toContain("legacyReader");
    expect(serialized).not.toContain("businessClassification");
  });
});
