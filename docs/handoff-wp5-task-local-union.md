# Handoff：WP-5 `task-local-union-source`

日期：2026-09-03（原 2026-09-02）  
用途：data-graph 侧 WP-5 技术 handoff。**产品主路径**已迁至 `docs/execution-plan-gold-case-investigation.md`。

---

## 一句话目标

把 N 份 WP-3 `TASK_LOCAL_PROJECTION` 并成 data-graph 可查询的 `sourceMode: TASK_LOCAL_UNION` 快照；跨任务靠物理表身份接续，不在构建期跑 multi-hop。

**调度为 `scheduleReference`，非数据血缘。**

---

## 仓库与远端

| 角色 | 路径 | Git |
|------|------|-----|
| **执行仓（WP-5）** | `E:\02_area\股衍数据-数据cookbook\scripts\data-graph` | https://github.com/rebeccagmgm/data-graph · 分支 `master` @ `c516898`（已推远端） |
| 上游产物仓（只读 / WP-3.2 才改） | `E:\02_area\股衍数据-数据cookbook\sql-static-lineage` | https://github.com/rebeccagmgm/sql-static-lineage · 分支 `input-pack-from-cache` @ `f6decb1` |

两侧**不共享源码**；只通过已发布产物契约交互。身份算法在 WP-3 侧已抄齐并对齐冻结向量。

---

## 必读文档（按顺序）

1. `docs/execution-plan-gold-case-investigation.md` — **金样调查页 V0（当前 P0）**
2. `sql-static-lineage/docs/execution-plan-task-local-union.md` — **WP-5 执行方案 TU-0…TU-8**（主规格）
2. `sql-static-lineage/docs/execution-plan-asset-graph.md` — 总地图
3. `sql-static-lineage/docs/execution-plan-task-local-projection.md` — 上游契约 1.2.0
4. `sql-static-lineage/docs/domain-asset-graph-architecture.md` — 共享不变量
5. data-graph 内现有 `DIRECT_PROJECT_EVIDENCE` / `project-evidence-root-traversal` design（避免重复造轮子）

Notion（可选对照）：[WP-3 任务局部图投影](https://app.notion.com/p/3cf007dec57781858d6ef3bd2da0b168) — schema 1.1.0 / `scheduleReference` / `partitionPredicateStatus` 已写。

---

## 已完成（不要重做）

### WP-3 + WP-3.1（sql-static-lineage）

- 归档：`openspec/changes/archive/2026-09-02-task-local-graph-projection/`
- 补丁 change：`openspec/changes/task-local-projection-wp31/`（schema **1.1.0**）
- 主规格：`openspec/specs/task-local-graph-projection/spec.md`
- CLI：`npm run project-task-local`
- 代码：`scripts/project-graph/task-local/`
- 金样：105387 / 119044 / 176827（需 sibling `sql-static-lineage-data/field-facts`）
- CI 提示：`AGENTS.md` 中 `TASK_LOCAL_GOLDEN_REQUIRED=1`（本仓尚无 `.github` workflow）

### 金样并集链形状（已对齐文档）

```text
105387  WRITES pdata_n.t03_agt_stati_info_h（四张 ref = DATASET_CONTROL）
119044  READS  pdata_n.t03_agt_stati_info_h（两次 READ，SRC_TBL 不同）
        READS  pdata_n.t03_otc_opt_comp_info（主表；writer 不在三金样内 → 走 producer-index 边界）
        WRITES pdata_n.t98_sb_otc_opt_comp_info
176827  READS  pdata_n.t98_sb_otc_opt_comp_info
        WRITES dm_rsk_n.otc_opt_greek_val_det_h
```

接续靠同一 `PHYSICAL_DATASET` 节点，**不是** TASK→TASK 数据边。

### data-graph 远端

- 本地仓已有历史；已 `remote add origin` 并推送 `master`（未 re-init）
- 工作树干净（相对 `origin/master`）

---

## 明确决策（已定）

1. **WP-5 落在 data-graph**，不挪回 sql-static-lineage。本仓最多 WP-3.2 补字段。
2. 三种 `sourceMode` 互斥：`LEGACY_ARTIFACT_PAIRS` / `DIRECT_PROJECT_EVIDENCE` / `TASK_LOCAL_UNION`。
3. **不改** `maxRoots = 32`、已发布 root 快照、六个参考查询。
4. loader **不**跑 multi-hop / field-lineage 闭包。
5. `scheduleReference`：`role: SCHEDULE_REFERENCE_ONLY`；可做展示边 `SCHEDULE_DEPENDS_ON`（TU-5 可选），**不参与**表级剪枝与字段推导。

---

## TU-0 前必须拍板（开 design 时写死）

§5.3 `SCHEDULE_ONLY` 的 targetTable 线索：

| 选项 | 做法 |
|------|------|
| **(a)** | WP-5 loader 自读调度缓存 |
| **(b)** | 开 **WP-3.2**，在 `scheduleReference` 增加 `targetTable`（方案文档倾向推荐） |

证据等级只能是 `CANDIDATE`，不得当 `CONFIRMED` writer。

---

## 建议起手（新对话第一条）

在 **data-graph** 仓库：

1. `openspec new change "task-local-union-source"`（或等价 propose）
2. 实现 **TU-0**：`ProjectTopologySnapshotV1` + `sourceMode: TASK_LOCAL_UNION` 契约/校验；envelope 解包；三方 contentHash；mode 互斥
3. 夹具驱动，不必一上来接真 Facts
4. 每个合入前：`npm run typecheck` / `build` / `test` / `format:check`，且 legacy / direct 回归绿

领取顺序：TU-0 → TU-1 → TU-2；（TU-3 与 TU-2 并行但导出前冻结）→ TU-4（主门槛）→ TU-6 贯穿 → TU-7 金样 → TU-8 成本。TU-5 可选。

---

## 原料路径（真金样时）

| 输入 | 典型位置 |
|------|----------|
| `batch-manifest.json` | `<project-graph-root>/batch-manifest.json` |
| envelope | `<project-graph-root>/tasks/<id>/task-local-projection.json` |
| producer-index | data-root 侧 `TABLE_PRODUCER_INDEX` |
| 调度缓存 | schedule-evidence（仅 SCHEDULE_ONLY / 展示） |
| Facts / packs | sibling `sql-static-lineage-data`（本地金样） |

WP-5 **不读** `field-lineage.json` / multi-hop 闭包文件建并集。

---

## 不要做

- 不实现 WP-4 `processingKind`
- 不把 causal-closure 重跑引擎搬进 loader
- 不用调度边替代 SQL 表级接续
- 不一表多写静默选唯一 writer
- 不为「链通」手工归并 nodeId
- 不在 sql-static-lineage 顺手改投影器（字段需求 → WP-3.2）
- **不要**把 sql-static-lineage 工作区里无关的 hive/visualize/causal-closure 脏文件塞进 WP-5 PR

### sql-static-lineage 当前脏区（无关，勿提交进 WP-5）

`fill-hive-*` / `hive-task-sql-cache` / causal-closure / `field-lineage-visualize` 及相关 tests；`.cursorignore` / `.vscode` / `scripts/input/tmp/`。

---

## 粘贴到新对话的启动句（可选）

```text
执行 WP-5 task-local-union-source，从 TU-0 开始。
工作目录：E:\02_area\股衍数据-数据cookbook\scripts\data-graph（github.com/rebeccagmgm/data-graph）。
主方案：../sql-static-lineage/docs/execution-plan-task-local-union.md（及同目录 handoff-wp5-task-local-union.md）。
硬约束：调度为 scheduleReference，非数据血缘；三种 sourceMode 互斥；不改 legacy maxRoots/root 快照。
TU-0 design 里拍板 §5.3 targetTable：自读调度缓存 vs WP-3.2。
先夹具，TU-4/TU-7 再用 105387→119044→176827 真 Facts。
```

---

## 前序对话

Cursor transcript：`84a4203a-fca2-4bd2-ab5e-c41e80cfd1a5`（WP-3.1 合入说明、Notion、docs、data-graph 推远端、仓库边界决策）。
