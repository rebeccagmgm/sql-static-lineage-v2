export type QueryStatus = "ok" | "partial" | "not_found";

export type PartitionMatchStatus =
  "CONFIRMED" | "ASSUMED" | "UNKNOWN" | "DISJOINT";

export interface SourceTestVector {
  readonly path: string;
  readonly testCount: number;
}

export interface SourceEvidenceVector {
  readonly repository: string;
  readonly commit: string;
  readonly syntheticTestFiles: readonly SourceTestVector[];
  readonly observedRun: {
    readonly fileCount: number;
    readonly passed: number;
    readonly failed: number;
    readonly syntheticPassed: number;
    readonly driftProneFailure: string;
    readonly statusBefore: "CLEAN";
    readonly statusAfter: "CLEAN";
  };
}

export interface PartitionPredicateVector {
  readonly column: string;
  readonly operator: "EQUALS";
  readonly partitionStatus: "COMPLETE" | "UNKNOWN";
  readonly valueKind: "LITERAL" | "RUNTIME_EXPRESSION" | "UNAVAILABLE";
  readonly observedValue: string | null;
  readonly expression: string | null;
}

export interface ContinuationWriteVector {
  readonly taskId: string;
  readonly taskCoverage: "PROJECTED" | "SCHEDULE_ONLY" | "COLLECTION_FAILED";
  readonly writeObservationId: string;
  readonly targetWriteNodeId: string;
  readonly partitionPredicate: PartitionPredicateVector;
}

export interface ContinuationCandidateVector {
  readonly taskId: string;
  readonly readOccurrenceId: string;
  readonly writeObservationId: string;
  readonly targetWriteNodeId: string;
  readonly partitionMatchStatus: PartitionMatchStatus;
  readonly evidenceLayer: "L1" | "L2";
  readonly l1Eligible: boolean;
  readonly disposition: "RETAINED" | "PRUNED";
  readonly gapCodes: readonly string[];
}

export interface ContinuationVector {
  readonly input: {
    readonly consumerTaskId: string;
    readonly readOccurrenceId: string;
    readonly readOccurrenceNodeId: string;
    readonly datasetNodeId: string;
    readonly readPartitionPredicate: PartitionPredicateVector;
    readonly writes: readonly ContinuationWriteVector[];
  };
  readonly observed: {
    readonly entryKey: string;
    readonly candidates: readonly ContinuationCandidateVector[];
    readonly l1WriteObservationIds: readonly string[];
    readonly excludedTaskIds: readonly string[];
  };
}

export interface EvidenceVector {
  readonly evidenceRef: string;
  readonly kind: string;
}

export interface NodeVector {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly label: string;
  readonly evidenceRefs: readonly string[];
  readonly boundaryReason?: string;
}

export interface EdgeVector {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly relationLayer: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly evidenceRefs: readonly string[];
  readonly producerRole?: string;
  readonly exactReadOccurrenceId?: string;
  readonly exactWriteObservationId?: string | null;
}

export interface TraceOutputVector {
  readonly status: QueryStatus;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly warnings: readonly string[];
  readonly truncated: boolean;
  readonly traversalDirection?: "OUTGOING" | "INCOMING_REVERSE";
}

export interface ExplainOutputVector {
  readonly status: QueryStatus;
  readonly recordId: string;
  readonly endpointNodeIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly attachmentRecordIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface TraceInvocationVector {
  readonly operation: "trace";
  readonly startNodeId: string;
  readonly direction: "OUTGOING" | "INCOMING_REVERSE";
  readonly relationLayers: readonly string[];
  readonly maxHops: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxPaths: number;
}

export interface GetInvocationVector {
  readonly operation: "get";
  readonly limit: number;
  readonly nodeTypes: readonly string[];
  readonly relationLayers: readonly string[];
}

export interface ExplainInvocationVector {
  readonly operation: "explain";
  readonly recordId: string;
  readonly maxAttachments: number;
}

export interface TopologyVector {
  readonly input: {
    readonly nodes: readonly NodeVector[];
    readonly edges: readonly EdgeVector[];
    readonly evidence: readonly EvidenceVector[];
    readonly sourceArtifactIds: readonly string[];
    readonly invocations: {
      readonly dataTrace: TraceInvocationVector;
      readonly scheduleTrace: TraceInvocationVector;
      readonly limitedGet: GetInvocationVector;
      readonly missingTrace: TraceInvocationVector;
      readonly edgeExplanation: ExplainInvocationVector;
    };
  };
  readonly observed: {
    readonly dataTrace: TraceOutputVector;
    readonly scheduleTrace: TraceOutputVector;
    readonly limitedGet: TraceOutputVector;
    readonly missingTrace: TraceOutputVector;
    readonly edgeExplanation: ExplainOutputVector;
  };
}

export interface PrecisionRecordVector {
  readonly recordId: string;
  readonly recordType: "READ_OCCURRENCE" | "WRITE_OBSERVATION";
  readonly identity: string;
  readonly evidenceRefs: readonly string[];
}

export interface FieldVector {
  readonly input: {
    readonly targetFieldNodeId: string;
    readonly nodes: readonly NodeVector[];
    readonly edges: readonly EdgeVector[];
    readonly evidence: readonly EvidenceVector[];
    readonly precisionRecords: readonly PrecisionRecordVector[];
    readonly invocations: {
      readonly valueTrace: TraceInvocationVector;
      readonly edgeExplanation: ExplainInvocationVector;
    };
  };
  readonly observed: {
    readonly valueTrace: TraceOutputVector & {
      readonly annotationEdgeIds: readonly string[];
    };
    readonly boundary: {
      readonly coverageStatus: "PARTIAL";
      readonly boundaryNodeId: string;
      readonly reason: string;
    };
    readonly edgeExplanation: ExplainOutputVector;
  };
}

export interface CausalBranchVector {
  readonly branchId: string;
  readonly producerTaskId: string | null;
  readonly writeObservationId: string | null;
}

export interface CausalAssessmentVector {
  readonly assessmentId: string;
  readonly branchId: string;
  readonly relationStatus: "CONFIRMED_RELATED" | "UNKNOWN";
  readonly channels: readonly ("FIELD_VALUE" | "ROW_MEMBERSHIP")[];
  readonly evidenceRefs: readonly string[];
  readonly gapRefs: readonly string[];
}

export interface CausalGapVector {
  readonly gapId: string;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
}

export interface CausalVector {
  readonly input: {
    readonly targetWriteNodeId: string;
    readonly runtimeRerunDecision: "NOT_EVALUATED";
    readonly branches: readonly CausalBranchVector[];
    readonly assessments: readonly CausalAssessmentVector[];
    readonly gaps: readonly CausalGapVector[];
    readonly evidence: readonly EvidenceVector[];
    readonly invocations: {
      readonly confirmedFilter: {
        readonly operation: "get";
        readonly relationStatuses: readonly string[];
        readonly channels: readonly string[];
        readonly limit: number;
      };
      readonly fieldValueFilter: {
        readonly operation: "get";
        readonly relationStatuses: readonly string[];
        readonly channels: readonly string[];
        readonly limit: number;
      };
      readonly taskRollup: {
        readonly operation: "rollup";
        readonly taskId: string;
        readonly limit: number;
      };
      readonly gapExplanation: {
        readonly operation: "explain";
        readonly assessmentId: string;
        readonly maxAttachments: number;
      };
    };
  };
  readonly observed: {
    readonly confirmedFilter: {
      readonly status: QueryStatus;
      readonly assessmentIds: readonly string[];
      readonly warnings: readonly string[];
    };
    readonly fieldValueFilter: {
      readonly status: QueryStatus;
      readonly assessmentIds: readonly string[];
    };
    readonly taskRollup: {
      readonly status: QueryStatus;
      readonly taskId: string;
      readonly inMinimumCertainSet: boolean;
      readonly assessmentIds: readonly string[];
    };
    readonly gapExplanation: {
      readonly status: QueryStatus;
      readonly assessmentId: string;
      readonly gapIds: readonly string[];
      readonly channelCount: number;
    };
  };
}

export interface ViewDocumentVector {
  readonly recordId: string;
  readonly searchText: string;
  readonly evidenceRefs: readonly string[];
}

export interface ViewVector {
  readonly input: {
    readonly documents: readonly ViewDocumentVector[];
    readonly evidence: readonly EvidenceVector[];
    readonly searchInvocations: readonly {
      readonly query: string;
      readonly limit: number;
    }[];
    readonly publishInvocations: readonly {
      readonly invocationId: string;
      readonly topologySnapshotId: string;
      readonly fieldSnapshotIds: readonly string[];
      readonly taskPackFingerprint: string;
      readonly semanticContentKey: string;
      readonly generatedAt: string;
    }[];
  };
  readonly observed: {
    readonly htmlMarkers: readonly string[];
    readonly searches: readonly {
      readonly query: string;
      readonly recordIds: readonly string[];
    }[];
    readonly evidencePanel: {
      readonly recordId: string;
      readonly evidenceRefs: readonly string[];
    };
    readonly publications: readonly {
      readonly invocationId: string;
      readonly status: "CREATED" | "REUSED";
      readonly viewId: string;
    }[];
  };
}

export interface DataGraphBehaviorBaseline {
  readonly source: SourceEvidenceVector;
  readonly continuation: ContinuationVector;
  readonly topology: TopologyVector;
  readonly field: FieldVector;
  readonly causal: CausalVector;
  readonly view: ViewVector;
  readonly fileIntegrity: {
    readonly input: {
      readonly tamperedFile: {
        readonly fileName: string;
        readonly mutation: "REPLACE_BYTES";
      };
      readonly tamperedManifest: {
        readonly fileName: string;
        readonly mutation: "REPLACE_DECLARED_HASH";
      };
      readonly interruptedPublish: {
        readonly interruptionPoint: "BEFORE_INSTALL";
      };
    };
    readonly observed: {
      readonly tamperedFileError: string;
      readonly tamperedManifestError: string;
      readonly interruptedFinalVisible: false;
    };
  };
  readonly scope: {
    readonly retainedCapabilities: readonly string[];
    readonly excludedCapabilities: readonly string[];
  };
}
