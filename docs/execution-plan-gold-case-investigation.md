# 金样调查页：执行方案（DM_RSK_N 四锚点 · 向上穿透 · 一张并集图）

配套：

| 文档 | 读什么 |
| --- | --- |
| `domain-asset-graph-architecture.md` | 机器单位（写观察×读次）、三层、端到端数据流 |
| `execution-plan-asset-graph.md` | 总地图、WP 状态、里程碑 |
| `execution-plan-task-local-projection.md` | WP-3 纸条契约 1.2.0 |
| `execution-plan-task-local-union.md` | WP-5 并集 + WP-8 接续 |
| `graph-accuracy-architecture.md` | 准确性冻结、接续四态 |
| `graph-user-narrative.md` | L0–L3 对用户怎么讲 |

---

## 0. 一页摘要

### 要什么

从 **四个 DM_RSK_N 写任务**（不是四张表本身）出发，**尽可能向上穿透**所有在 Input Pack + producer-index 上能走到的上游任务，为穿透闭包内每个任务做 **任务局部投影（WP-3）**，再并成 **一张图**，用 **接续索引（WP-8.1）** 回答「这个读次的上游写观察是谁、分区能否对上」。

证得出的写 **CONFIRMED**；证不出的写 **gap**（JSONL + L0–L3），驱动修 WP-7/8/11——**不以闭包 L1 计数、不以 HTML 为验收**。

### 方案三句话

1. **批怎么定**：`--task-ids` 四锚点 + `--expand-upstream`（SQL READ → producer-index confirmed producer → 递归），**不用** `--topic DM_RSK_N` 扫同域平级任务。
2. **图怎么拼**：每任务一张 `TASK_LOCAL_PROJECTION` 纸条 → 并集 merge（WP-5，嵌在 INDEX 构建里）→ 全批 `UNION_CONTINUATION_INDEX`（读次×写观察×`partitionMatchStatus`）。
3. **你怎么消费**：读 `batch-manifest.json` + `tasks/*/task-local-projection.json` + `union-continuation-index.json`；四锚点只是 **查询入口**，不是四份图。

### 主交付物（P0）

| 产物 | 必须 |
| --- | --- |
| `batch-manifest.json`（含 `upstreamExpansion`） | ✓ |
| `tasks/<id>/task-local-projection.json` | ✓ |
| `union-continuation-index.json` + `manifest.json` | ✓ |
| `gold-case-gaps.jsonl` | ✓（GC-3） |
| L0–L3 报告（JSON 或 MD） | ✓（GC-3） |
| HTML | 可选 |

### 当前阶段（2026-09-03）

| 项 | 状态 |
| --- | --- |
| WP-3 纸条 1.2.0 | **已验收** |
| WP-5 merge 库 | **完成**（data-graph） |
| WP-8.1 INDEX CLI | **完成**（data-graph） |
| `--task-ids` + `--expand-upstream` | **已实现**（GC-1） |
| **真数据跑通 GC-0** | **未做** ← **当前阻塞** |
| gaps / L0–L3 报告 | **未做**（GC-3） |
| 一键脚本 `gold-case:unified` | **未做**（GC-2） |

### 你接下来立刻做什么（顺序）

```text
① 跑穿透批投影（GC-0 步骤 1）     → batch-manifest + 纸条
② 跑接续索引（GC-0 步骤 2）       → union-continuation-index.json
③ 审 manifest.upstreamExpansion   → 缺 Pack 的上游要不要补采
④ 写 gold-case-gaps.jsonl（GC-3）  → 四锚点每个 externalRead 有 entry 或 gap
⑤ 写分锚点 L0–L3（GC-3）
⑥ （可选）GC-2 一键脚本、GC-5 HTML
```

细则见 **§8 路线图**。

---

## 1. 问题与目标

### 1.1 本方案解决什么

- **调查页 V0**：四张 DM_RSK_N 目标表对应的写任务，连同 **向上能穿透到的全部调度投影**，融成 **一张可程序消费的并集图**。
- **诚实边界**：每个锚点尽全力追到能证的层级；证不了的 **具名 reasonCode**，禁止静默省略或假 TASK 边。
- **反哺工程**：用这批真语料修契约/工具（WP-7/8/11），**不**再扩 WP-10 闭包 KPI。

### 1.2 不解决什么

- 不铺 13k 任务全库并集
- 不以 WP-10 legacy 闭包 L1 数验收
- 不承诺四锚点 **全部输出列** 跨任务 FIELD_DIRECT 闭合（V0 表级 + 选定高价值列）
- 不把调度 `upstreamTaskIds` 当数据血缘（仅 L0 `scheduleReference`）
- HTML 不是 P0 交付物

> 若还有第五个同等级写锚点，在 §3 表补一行；批策略与验收规则不变。

---

## 2. 方案总览

### 2.1 端到端数据流

```text
                    ┌─ Input Pack（sql-static-lineage-data）
                    ├─ Machine Facts（field-facts）
                    └─ producer-index（sql-static-lineage-data.producer-index）
                                        │
    四锚点 taskId ──expand-upstream──► 穿透闭包 taskIds
                                        │
                                        ▼
                         WP-3  project-task-local（每任务纸条）
                                        │
                    batch-manifest.json + tasks/*/task-local-projection.json
                                        │
                                        ▼
                         WP-8.1 union-continuation-index（data-graph）
                                        │
                    union-continuation-index.json  ← 【主消费面】
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
         gold-case-gaps.jsonl                    L0–L3 报告（GC-3）
         trace-report（可选 MD/JSON）            HTML（可选 GC-5）
```

### 2.2 批任务怎么定（核心决策）

| 策略 | 命令 | 适用 |
| --- | --- | --- |
| **推荐：锚点向上穿透** | `--task-ids 181058,176827,209119,155015 --expand-upstream` | **金样 P0** |
| 备选：同域横向全扫 | `--topic DM_RSK_N` | 同域 ~63 任务对比；**不是**金样主路径 |
| 手动补洞 | `--also-task-ids …` | Pack 已有但穿透未纳入的任务 |

**穿透算法**（`anchor-upstream-expansion.ts` → `runProjectInputPackClosure`）：

```text
对每个锚点：
  读 Task Pack SQL 中的 READ 表名
    → 查 producer-index confirmedProducerEdges 得 writer taskId
    → 若该表在 terminal-table-rules 终止 → 停
    → 若 writer 在 dataRoot 有 Pack → 加入闭包，depth+1 继续
    → 若 writer 无 Pack → 记入 upstreamExpansion.issues，不伪造投影
四锚点闭包取并集 → batch taskIds
```

默认 `--max-upstream-depth 25`；producer-index 默认 `<data-root>.producer-index`。

**「一张图」在数据里指什么**：

- 同一 `batch-manifest.contentHash` 闭包下的全部 `TASK_LOCAL_PROJECTION`；
- **一份** `UNION_CONTINUATION_INDEX`（全批 `externalReads`，不按锚点拆文件）；
- 并集外 writer 以 `WRITER_NOT_IN_UNION` / `NO_KNOWN_WRITER` **边界节点**出现，不静默删。

### 2.3 三层职责（不变）

| 层 | 职责 | WP |
| --- | --- | --- |
| ① Facts | Input Pack + Machine Facts + producer-index | WP-6 |
| ② 投影/接续 | 纸条 → merge → INDEX | WP-3、WP-5、WP-8.1 |
| ③ 呈现 | 可消费 JSON + gap + L0–L3 | GC、WP-12 |

调度只进 L0，**不参与**接续剪枝。

---

## 3. 四锚点（查询入口）

「关心这条链路」= 该任务的 **TARGET_WRITE**（写观察），不是 TASK 节点。

| 锚点 | taskId | 目标表 | 语料角色 |
| --- | --- | --- | --- |
| A | **181058** | `dm_rsk_n.otc_opt_inr_comp_pal_sum` | WP-7 本地折叠 / materialization |
| B | **176827** | `dm_rsk_n.otc_opt_greek_val_det_h` | ~11 读表、97 列；spine 105387→119044 |
| C | **209119** | `dm_rsk_n.otc_opt_sub_trd_info` | 控制边膨胀、多分支 |
| D | **155015** | `dm_rsk_n.v_risk_audit_log` | 跨域值链 + 105387 拉链 ref |

四锚点同域 DM_RSK_N，血缘 **必然跨域**（pdata_n、EDW_AGT、ODATA_N_TIT 等）。

### 3.1 已知表级 spine（验收时必须能在 INDEX 上核对）

```text
【B 176827】
  105387 ──WRITES──> pdata_n.t03_agt_stati_info_h <──READ── 119044
  119044 ──WRITES──> pdata_n.t98_sb_otc_opt_comp_info <──READ── 176827

【D 155015】值链（示例）
  112715 → 114026 → … → 155015
  71698 → 105387 → … → 155015（四 ref 为 DATASET_CONTROL / ROW_MEMBERSHIP，非 FIELD_DIRECT）

【A 181058】【C 209119】
  以穿透闭包内 WRITES 对接 + INDEX 为准；209119 控制边去重、分支 gap 留档
```

### 3.2 与旧「三任务金样」

`105387 → 119044 → 176827` 是锚点 B 的 **子链**；TU-7 / TL-6 测试继续有效。

---

## 4. 端到端执行（命令链）

路径按本机仓库布局；PowerShell 用反引号 `` ` `` 续行，**必须先 `cd` 到项目根**。

### 步骤 1：穿透批投影（sql-static-lineage）

```powershell
cd "E:\02_area\股衍数据-数据cookbook\sql-static-lineage"

npm run project-task-local -- `
  --data-root "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data" `
  --facts-root "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data\field-facts" `
  --schedule-cache "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-cache\schedule-evidence" `
  --output-root "artifacts/gold-case-dm-rsk-n/project-graph" `
  --task-ids 181058,176827,209119,155015 `
  --expand-upstream `
  --producer-index-root "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data.producer-index"
```

**检查** `artifacts/gold-case-dm-rsk-n/project-graph/batch-manifest.json`：

- `anchorTaskIds` = 四锚点
- `upstreamExpansion.taskIds` = 穿透并集大小（预期远小于 63，大于 4）
- `upstreamExpansion.issues` = 缺 Pack / 触顶等
- `tasks[]` 里四锚点 `coverageStatus` 应为 `PROJECTED`（若 `SCHEDULE_ONLY` / `FAILED` 先修 Facts/Pack）

### 步骤 2：接续索引（data-graph）

```powershell
cd "E:\02_area\股衍数据-数据cookbook\scripts\data-graph"

npm run union-continuation-index -- `
  --batch-dir "E:\02_area\股衍数据-数据cookbook\sql-static-lineage\artifacts\gold-case-dm-rsk-n\project-graph" `
  --producer-index "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data.producer-index\producer-index.json" `
  --output-dir "tmp/gold-case-dm-rsk-n-continuation-index"
```

产出：`tmp/gold-case-dm-rsk-n-continuation-index/union-continuation-index.json` + `manifest.json`。

### 步骤 3：程序消费（示例：锚点 B）

```text
1. tasks/176827/task-local-projection.json
     → localClosure.externalReads[]（读次列表）

2. union-continuation-index.json
     → entries[] 按 consumerTaskId=176827 + readOccurrenceId 查找

3. 每个 entry：
     → candidates[].partitionMatchStatus、l1Eligible
     → 无候选或 gap → 写入 gold-case-gaps.jsonl（一行一条）
```

schema：`UNION_CONTINUATION_INDEX` 1.0.0（data-graph 写；sql-static-lineage 只读解析）。

### 步骤 4（可选）：人读 HTML

```powershell
cd "E:\02_area\股衍数据-数据cookbook\sql-static-lineage"

npm run visualize-task-local-machine-graph -- `
  --full-stack `
  --continuation-index "../scripts/data-graph/tmp/gold-case-dm-rsk-n-continuation-index/union-continuation-index.json" `
  --batch-manifest "artifacts/gold-case-dm-rsk-n/project-graph/batch-manifest.json" `
  --output "artifacts/gold-case-dm-rsk-n/machine-graph.html"
```

（若 CLI 尚未支持 `--batch-manifest` glob 全批，可暂用手动列 `--projection`；GC-2 统一。）

### 穿透停在哪里（诚实边界）

| 会继续走 | 不会当数据上游 |
| --- | --- |
| producer-index `confirmedProducerEdges` | 调度 `upstreamTaskIds` |
| dataRoot 里已有 Task Pack 的任务 | 无 Pack 的 producer（manifest issues） |
| 非 `terminal-table-rules` 的 READ 表 | 终止表 / 参考表 |

**缺 Pack 的上游**：当前穿透 **不会** 自动采集；若要扩闭包，需 Input Pack 采集（`input-pack:from-cache` / `lineage:all` autofill）后 **重跑步骤 1**。

---

## 5. 产物契约

### 5.1 目录布局（GC-0 完成后）

```text
artifacts/gold-case-dm-rsk-n/
├── project-graph/
│   ├── batch-manifest.json          # 批登记 + upstreamExpansion
│   └── tasks/
│       └── <taskId>/
│           └── task-local-projection.json
├── gold-case-gaps.jsonl             # GC-3
├── gold-case-trace-report.json      # GC-3（或 .md）
└── machine-graph.html               # 可选

../scripts/data-graph/tmp/gold-case-dm-rsk-n-continuation-index/
├── union-continuation-index.json    # 【主消费面】
└── manifest.json
```

### 5.2 `batch-manifest.json` 关键字段

| 字段 | 含义 |
| --- | --- |
| `anchorTaskIds` | 四锚点 |
| `expandUpstream` | 是否做了穿透 |
| `upstreamExpansion.taskIds` | 穿透得到的任务集 |
| `upstreamExpansion.discoveredTaskIds` | 含锚点在内的发现集 |
| `upstreamExpansion.issues` | 缺 Pack、轮次触顶等 |
| `upstreamExpansion.counters` | 读表次数、producer 刷新等 |
| `taskIds` | 实际投影批（穿透 ∪ also-task-ids） |
| `tasks[].coverageStatus` | `PROJECTED` / `SCHEDULE_ONLY` / `FAILED` |

### 5.3 `gold-case-gaps.jsonl` 行格式（GC-3 约定）

每行一条 JSON，建议字段：

```json
{
  "gapId": "GC-GAP-001",
  "anchorTaskId": "176827",
  "consumerTaskId": "176827",
  "readOccurrenceId": "…",
  "qualifiedName": "pdata_n.t03_otc_opt_comp_info",
  "reasonCode": "WRITER_NOT_IN_UNION",
  "layer": "L1",
  "proposedWp": "WP-8",
  "note": "writer 119044 在批内但分区 DISJOINT"
}
```

---

## 6. 验收：分锚点 + L0–L3

全图共享同一 merge/INDEX。列级 L1 能证则证；不能证进 `gold-case-gaps.jsonl` 驱动修 WP。

| 锚点 | 表级 L1（INDEX） | 字段级 | 已知难点 |
| --- | --- | --- | --- |
| **181058** | 并集内 WRITES；无假 TASK 边 | localFieldPaths / 折叠边 | temp 折叠、读次身份 |
| **176827** | spine 105387↔119044↔176827 | 97 列先 **高价值列** 清单 | 主表 writer 批外 → 边界或补 Pack |
| **209119** | 表级扇入 + 分区剪枝 | 控制边≠值边 | 分支 UNKNOWN 要 reasonCode |
| **155015** | 跨域 writer 在批内或边界 | 值链 vs 四 ref 控制边 | 71698/105387 拉链 |

### L0–L3（每锚点一段，写入 GC-3 报告）

| 层 | 要求 |
| --- | --- |
| **L0** | 批内 projected / scheduleOnly / failed；四锚点是否 PROJECTED |
| **L1** | 仅 `partitionMatchStatus=CONFIRMED` 且 `l1Eligible` 可写「确定」 |
| **L2** | ASSUMED / 批外 writer / 多写未剪枝 → 标候选 |
| **L3** | UNKNOWN、DISJOINT、Facts 缺口 → reasonCode，禁止「暂无」 |

---

## 7. 实现状态

| 能力 | 仓库 | 状态 |
| --- | --- | --- |
| WP-3 `TASK_LOCAL_PROJECTION` 1.2.0 | sql-static-lineage | **已验收** |
| TL-6 golden（105387/119044/176827） | sql-static-lineage | **有** |
| TL-6 golden（209119/155015） | sql-static-lineage | **待 GC-4**；表级清单见 `execution-plan-table-lineage-acceptance.md` |
| `--task-ids` + `--expand-upstream` | sql-static-lineage | **已实现（GC-1）** |
| WP-5 `mergeTaskLocalUnion` | data-graph | **库完成** |
| WP-8.1 `union-continuation-index` CLI | data-graph | **完成** |
| 真数据 GC-0 跑通 | — | **未做** |
| `gold-case-gaps.jsonl` + L0–L3 | — | **未做（GC-3）** |
| `npm run gold-case:unified` | sql-static-lineage | **未做（GC-2）** |
| HTML 四锚点高亮 | sql-static-lineage | **可选（GC-5）** |
| WP-10 closure-on-union | sql-static-lineage | **暂停** |

---

## 8. 路线图：接下来做什么

按顺序执行；前一步未通过不进入下一步。

### 阶段 A — 跑通可消费产物（GC-0）【当前 P0】

| # | 动作 | 产出 | 完成标准 |
| --- | --- | --- | --- |
| A1 | 步骤 1：穿透批投影 | `batch-manifest.json` + 纸条 | 四锚点 `PROJECTED`；`upstreamExpansion` 无意外空批 |
| A2 | 审 `upstreamExpansion.issues` | 决策记录 | 缺 Pack 列表：补采 or 接受边界 |
| A3 | 步骤 2：接续 INDEX | `union-continuation-index.json` | 四锚点每个 `externalRead` 有 entry 或 INDEX gap |
| A4 | 首版 `gold-case-gaps.jsonl` | jsonl | 所有 INDEX gap + manifest issues 具名 |
| A5 | 首版 L0–L3 报告 | json/md | 四锚点各一段 |

**GC-0 勾选清单**：

- [ ] A1 batch-manifest + 四锚点 PROJECTED 纸条
- [ ] A3 union-continuation-index.json + manifest.json
- [ ] A4 gold-case-gaps.jsonl 首版
- [ ] A5 分锚点 L0–L3
- [ ] （可选）HTML

### 阶段 B — 固化与回归（GC-4）

| # | 动作 |
| --- | --- |
| B1 | `golden-samples.test.ts` 增加 209119、155015 |
| B2 | INDEX 集成测：四锚点读次 entry / gap 断言 |
| B3 | 穿透批 task 数 / spine 边 snapshot（防回归） |

### 阶段 C — 工程化（GC-2）

| # | 动作 |
| --- | --- |
| C1 | `npm run gold-case:unified`：步骤 1→2→（可选 HTML），固定输出目录 |
| C2 | 可选独立落盘 `union-merge-report.json` |

### 阶段 D — 体验（GC-5，可选）

| # | 动作 |
| --- | --- |
| D1 | `--batch-manifest` 自动 glob 全批 projection |
| D2 | 四锚点切换高亮 |

### 阶段 E — 扩穿透（按需，非 GC-0 阻塞）

| # | 动作 | 何时 |
| --- | --- | --- |
| E1 | 对 `upstreamExpansion.issues` 里缺 Pack 的 taskId 跑 Input Pack 采集 | A2 决定补采时 |
| E2 | 重跑 A1–A3 | Pack 补齐后 |
| E3 | szdata 在线 discovery（`reconcile-multi-hop:autofill` 路径） | 仅 producer-index 也没有时 |

### 阶段 F — 列级攻坚（M0 之后）

按 `gold-case-gaps.jsonl` 的 `proposedWp` 逐条修 WP-7/8/11；**不**开 WP-10。

---

## 9. 工作包（GC）定义

| GC | 名称 | 状态 | 内容 |
| --- | --- | --- | --- |
| **GC-0** | 端到端产物 | **进行中** | 阶段 A：穿透批 + INDEX + gaps + L0–L3 |
| **GC-1** | 锚点穿透 CLI | **完成** | `--task-ids` + `--expand-upstream` |
| **GC-2** | 一键脚本 | 未做 | `gold-case:unified` |
| **GC-3** | 验收报告 | 未做 | gaps.jsonl + L0–L3 |
| **GC-4** | 测试回归 | 未做 | 209119/155015 golden + INDEX 断言 |
| **GC-5** | HTML 调查页 | 可选 | full-stack + 锚点高亮 |

---

## 10. 明确不做

- 不以 WP-10 legacy 闭包 L1 计数验收本调查页
- 不为「让四锚点全绿」合并 `PHYSICAL_DATASET` 身份分歧
- 不先把 13k 任务铺进同一张图
- 不用 `--topic DM_RSK_N` 作为金样主批（仅备选横向对比）
- 不承诺四锚点全部输出列跨任务 FIELD_DIRECT 闭合（V0）

---

## 11. 与 WP 对照

| WP | 金样中的角色 |
| --- | --- |
| WP-3 | 穿透闭包内每任务纸条 |
| WP-5 | merge 成一张并集（INDEX 内嵌） |
| WP-8.1 | 全批读次接续 INDEX — **主消费面** |
| WP-7 | 身份/读次/折叠 — gaps 驱动修 |
| WP-11 | 列路径 — 高价值列清单后攻坚 |
| WP-12 | L0–L3 envelope — 与 GC-3 同步 |
| WP-10 | **不参与验收**（已暂停） |

---

## 12. 仓库与路径速查

| 角色 | 路径 |
| --- | --- |
| 执行仓（WP-3、GC） | `E:\02_area\股衍数据-数据cookbook\sql-static-lineage` |
| 接续 INDEX（WP-8.1） | `E:\02_area\股衍数据-数据cookbook\scripts\data-graph` |
| Input Pack | `..\sql-static-lineage-data` |
| Machine Facts | `..\sql-static-lineage-data\field-facts` |
| producer-index | `..\sql-static-lineage-data.producer-index\producer-index.json` |
| 调度缓存 | `..\sql-static-lineage-cache\schedule-evidence` |
| GC-0 产出根 | `sql-static-lineage/artifacts/gold-case-dm-rsk-n/` |
