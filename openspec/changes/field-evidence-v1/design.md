## Context

完整方案见 `docs/execution-plan-field-evidence-v1.md`。本 change 只做 Phase 1。

## Goals / Non-Goals

**Goals:** 契约 1.3.0 不变量；投影生产期派生读次/subtype/侧别；三组 cohort baseline。

**Non-Goals:** Impact Query；改 INDEX/SQLLens/Facts；Facts `input_fields[].source_relation_id`（登记为发布器侧 WP）。

## Decisions

### D0. FE-0 契约先行（策略 A）

- FE-0：`contract.ts` + `ids.ts` helper + `contract.test.ts`；**不** bump `TASK_LOCAL_PROJECTION_SCHEMA_VERSION`，**不**改 `project-task-local.ts`。
- FE-1 同 PR：bump 常量、发射 1.3.0、`semanticKey` 写入。
- 校验：`>= 1.2.0` READS；`=== 1.3.0` 字段/控制/gaps 新规则。

### D1–D5

见 `execution-plan-field-evidence-v1.md` §5（物化 leaf、setop 下沉、物理 read relation、路径 subtype、relation 子树侧别）。

### D6. Cohort 命名

- `anchorExpansionBatch`（186）：锚点展开批，design corpus。
- `shadowEvaluationSlice`（158）：344−186，结构性泛化 sanity check，**非 gold/holdout 标注集**。
- 判据：shadow 提升不低于 anchor 提升的一半 → 防锚点特判，非统计检验。

### D7. fail-closed

- 非 RESOLVED → `sourceReadOccurrenceReason` + gap（FE-1 发射保证 1:1）。
- `UNKNOWN` → `subtypeReason`；`BOTH` → `CONTROL_SIDE_UNRESOLVED` gap。
- 契约层强制 reason；gap 与边的完整对应靠 FE-1 发射 + FE-B 统计。

### D8. Consumer 1.2.0 硬编码

`gate-b-union.ts`、`union-v2-field-value-provider.ts` 等拒 1.3.0——1.3.0 投影上线前登记修复，不在 FE-0。

## Migration Plan

1. FE-0 合入（契约 + 测试）。
2. FE-1…FE-3 + FE-1′ 同 PR bump 并重投锚点展开批。
3. FE-B baseline；按 §5.5 决定 Phase 2。

## Open Questions

- `expression_roles` window 覆盖率不足时的 D4 备选实现细节。
