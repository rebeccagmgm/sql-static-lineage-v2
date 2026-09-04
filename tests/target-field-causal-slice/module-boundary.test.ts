import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as causal from "../../scripts/reconcile/consumer/target-field-causal-slice/index.ts";
import * as causalContract from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-contract.ts";
import * as causalMatrix from "../../scripts/reconcile/consumer/target-field-causal-slice/operator-support-matrix.ts";
import * as causalNormalizer from "../../scripts/reconcile/consumer/target-field-causal-slice/semantic-dependency-normalizer.ts";
import {
  resolvePhysicalInputField,
} from "../../scripts/reconcile/consumer/field-lineage/physical-field-resolver.ts";

describe("target-field causal-slice module boundary", () => {
  it("owns the canonical contract, matrix, normalizer, and evidence adapter", () => {
    expect(causal.makeSemanticDependencyEdge).toBe(
      causalContract.makeSemanticDependencyEdge,
    );
    expect(causal.lookupOperatorSupport).toBe(
      causalMatrix.lookupOperatorSupport,
    );
    expect(causal.normalizePlanSemanticDependencies).toBe(
      causalNormalizer.normalizePlanSemanticDependencies,
    );
    expect(causal.resolvePhysicalInputField).toBe(resolvePhysicalInputField);
    expect(causal.createCanonicalEvidenceAdapter()).toBe(
      causal.canonicalEvidenceAdapter,
    );
    expect(Object.isFrozen(causal.canonicalEvidenceAdapter)).toBe(true);
  });

  it("no longer keeps field-lineage compatibility shims for semantic modules", () => {
    for (const relativePath of [
      "scripts/reconcile/consumer/field-lineage/semantic-dependency-contract.ts",
      "scripts/reconcile/consumer/field-lineage/operator-support-matrix.ts",
      "scripts/reconcile/consumer/field-lineage/semantic-dependency-normalizer.ts",
    ]) {
      expect(existsSync(relativePath), relativePath).toBe(false);
    }
  });

  it("no longer exports the retired field×branch product surface", () => {
    expect(causal).not.toHaveProperty("reconcileTargetFieldCausalSlice");
    expect(causal).not.toHaveProperty("publishTargetFieldCausalSlice");
    expect(causal).not.toHaveProperty("formatCausalSlice");
    expect(causal).not.toHaveProperty("TARGET_FIELD_CAUSAL_SLICE_ARTIFACT_TYPE");
    expect(causal).not.toHaveProperty("assessPositiveCausalRelationships");
    expect(causal).not.toHaveProperty("buildAssessmentPairSkeleton");
  });

  it("keeps the evidence adapter read-only and delegated to existing APIs", () => {
    const source = readFileSync(
      "scripts/reconcile/consumer/target-field-causal-slice/canonical-evidence-adapter.ts",
      "utf8",
    );
    expect(source).not.toMatch(
      /writeFile|appendFile|rmSync|mkdirSync|renameSync/,
    );
    expect(causal.canonicalEvidenceAdapter.resolvePhysicalInputField).toBe(
      resolvePhysicalInputField,
    );
  });
});
