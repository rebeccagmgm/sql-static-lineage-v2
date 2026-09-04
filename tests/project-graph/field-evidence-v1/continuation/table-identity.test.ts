import { describe, expect, it } from "vitest";

import {
  isNativeHiveComputeCategory,
  isToHiveSyncCategory,
  resolveProducerTableIdentity,
  unavailableReadScopeReason,
} from "../../../../scripts/project-graph/field-evidence-v1/continuation/table-identity.ts";

describe("producer table identity from task category", () => {
  it("defaults two-part names to hive/gfhive for native Hive compute types", () => {
    for (const taskCategory of ["sparkIndex", "hiveTask", "hiveTask-2.0"]) {
      expect(isNativeHiveComputeCategory(taskCategory)).toBe(true);
      expect(isToHiveSyncCategory(taskCategory)).toBe(false);
      expect(resolveProducerTableIdentity({
        qualifiedName: "schema.example_table",
        taskCategory,
      })).toEqual({
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "schema.example_table",
      });
    }
  });

  it("does not default hive2* or *2hive sync types", () => {
    for (const taskCategory of ["hive2oracle", "hive2mysql", "mysql2hive", "oracle2hive"]) {
      expect(isNativeHiveComputeCategory(taskCategory)).toBe(false);
      expect(resolveProducerTableIdentity({
        qualifiedName: "schema.example_table",
        taskCategory,
      })).toEqual({
        platform: "unknown",
        dataSource: "unknown",
        qualifiedName: "schema.example_table",
      });
    }
  });

  it("treats *2hive ingest as a source-endpoint boundary when PI has no writers", () => {
    expect(isToHiveSyncCategory("oracle2hive")).toBe(true);
    expect(isToHiveSyncCategory("mysql2hive")).toBe(true);
    expect(isToHiveSyncCategory("hive2oracle")).toBe(false);
    expect(unavailableReadScopeReason("oracle2hive")).toBe("SOURCE_ENDPOINT_BOUNDARY");
    expect(unavailableReadScopeReason("sparkIndex")).toBe("READ_SCOPE_UNAVAILABLE");
    expect(unavailableReadScopeReason(null)).toBe("READ_SCOPE_UNAVAILABLE");
  });

  it("keeps explicit three-part identities unchanged", () => {
    expect(resolveProducerTableIdentity({
      qualifiedName: "oracle.gforacle.schema.example_table",
      taskCategory: "sparkIndex",
    })).toEqual({
      platform: "oracle",
      dataSource: "gforacle",
      qualifiedName: "schema.example_table",
    });
  });
});
