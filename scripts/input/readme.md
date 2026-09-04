scripts/input/
├── mainline/   # 采集主线：批量入口、单任务采集、Input Pack 契约、状态
├── shared/     # 主线和修复/分区都会复用的端点、SQL 目标、类型映射
├── partition/  # 分区证据生成与已有 Pack 重建
└── repair/     # 已落盘 Pack 修复、缺失 Table Pack 补采

依赖主线：

```text
mainline/collect-task-input-pack.ts
    └── mainline/collect-one-task-input-pack.ts
            ├── shared/task-endpoints.ts
            ├── shared/sql-target-evidence.ts
            ├── shared/task-partition-evidence.ts
            └── shared/input-pack.ts

partition/rebuild-task-partition-evidence.ts ──> shared/*
repair/repair-stored-input-packs.ts ──────────> mainline/collect-one-task-input-pack.ts + shared/input-pack.ts
repair/repair-missing-table-packs.ts ─────────> mainline/collect-one-task-input-pack.ts + shared/input-pack.ts
```

`mainline/` 是正常采集入口；`shared/` 是被主线、分区重建和修复流程复用的证据/契约代码；`partition/` 和 `repair/` 都是对已采集结果的补充或纠偏，不是新的采集主线。



| 文件 | 作用 |
|---|---|
| [`collect-task-input-pack.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/mainline/collect-task-input-pack.ts) | 批量采集入口和 checkpoint 管理 |
| [`collect-one-task-input-pack.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/mainline/collect-one-task-input-pack.ts) | 单任务实时证据采集 |
| [`input-pack.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/shared/input-pack.ts) | Input Pack 数据模型、schema/hash、读写 |
| [`task-status.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/mainline/task-status.ts) | 任务级状态、跳过、恢复、checkpoint |
| [`task-batch.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/mainline/task-batch.ts) | 顺序批处理和失败隔离 |
| [`task-endpoints.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/shared/task-endpoints.ts) | source/target 物理端点判断和采集状态 |
| [`sql-target-evidence.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/shared/sql-target-evidence.ts) | 从 SQL 中识别最终写入目标 |
| [`task-partition-evidence.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/shared/task-partition-evidence.ts) | 生成任务分区和写入范围证据 |
| [`rebuild-task-partition-evidence.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/partition/rebuild-task-partition-evidence.ts) | 对已有 Task Pack 重建分区证据 |
| [`repair-stored-input-packs.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/repair/repair-stored-input-packs.ts) | 修复已落盘 Task Pack 的 SQL/元数据问题 |
| [`repair-missing-table-packs.ts`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/repair/repair-missing-table-packs.ts) | 根据 producer index 找到缺失 Table Pack 后重新采集 |
| [`task-type-map.json`](E:/02_area/股衍数据-数据cookbook/sql-static-lineage/scripts/input/shared/task-type-map.json) | Task 类型到内部分类的映射 |
