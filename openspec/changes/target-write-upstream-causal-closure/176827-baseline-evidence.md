# 176827 重跑收缩：实测基线（2026-09-01）

这份文件记录**播种前冻结**（`176827-baseline.json`，13:07）在 176827 上的真实产出。
它推翻了此前几个口头结论。后面追加的「155015 对照 / 对照产物不要混」必须跟
磁盘上的 `155015.json`、`176827.json` 对齐，不要再用本文件上半段的空档二去判
155015 回归。

后续所有工作包必须以本文件为起点，不要再引用「81 收到 69」那组数字。

## 复现命令

```bash
npm run reconcile-target-table-causal-closure -- \
  --data-root        <repo>/../sql-static-lineage-data \
  --facts-root       <repo>/../sql-static-lineage-data/field-facts \
  --producer-index   <repo>/../sql-static-lineage-artifacts/producer-index/current.json \
  --table-multi-hop  <repo>/../sql-static-lineage-data/artifacts/tasks/176827/multi-hop.json \
  --field-lineage    <repo>/../sql-static-lineage-data/artifacts/tasks/176827/field-lineage.json \
  --task-id 176827 \
  --target-table dm_rsk_n.otc_opt_greek_val_det_h \
  --write-observation-id write-observation:176827:platform-target:0 \
  --output       <artifacts>/target-table-causal-closure/176827-baseline.json \
  --summary-output <artifacts>/target-table-causal-closure/176827-baseline.txt
```

**`--write-observation-id` 是必需的。** 不传会 fail-fast 成
`TARGET_WRITE_UNRESOLVED:TARGET_WRITE_EVIDENCE_MISSING`。取值来自
`field-facts/registry/tasks/176827/bundle/dataset-io.jsonl` 中
`direction=write && field_producing=true` 的记录。

## 实测结果

耗时 7.9s，`peakMemoryBytes` 558,174,208（约 532MB，预算 1GB 内），未触达任何预算上限。

```text
candidateBranchCount   471
upstreamTaskCount      59
decisionCoverage       471/471 (1.000)
evidenceClosureRate    1.0
gaps                   918（全部 CAUSAL_EVIDENCE_INCOMPLETE）
runtimeRerunDecision   NOT_EVALUATED
```

### 分档产出

```text
档一 值必达      30 branch / 27 task    （FIELD_VALUE = CONFIRMED）
档二 行决定       0                     （ROW_MEMBERSHIP CONFIRMED = 0，UNKNOWN = 346）
档三 倍增风险     0                     （MULTIPLICITY  CONFIRMED = 0，UNKNOWN = 346）
档四 已剪除     198（只计数）
taskRollup      CONFIRMED_RELATED 27 / UNKNOWN 32
```

档一 27 个任务：

```text
71698 71813 78348 78471 78472 78588 103230 103234 103237 103943
104299 104446 105382 105385 105387 105395 108951 114497 117794 119044
121574 121575 139598 139835 150384 156498 213687
```

### 通道状态分布

```text
FIELD_VALUE/CONFIRMED           30
FIELD_VALUE/UNKNOWN            440
ROW_MEMBERSHIP/UNKNOWN         346      ROW_MEMBERSHIP/CONFIRMED       0
MULTIPLICITY/UNKNOWN           346      MULTIPLICITY/CONFIRMED         0
RELATION_EXISTENCE/UNKNOWN     346      RELATION_EXISTENCE/CONFIRMED   0
其余通道                        NOT_APPLICABLE 或 UNKNOWN
```

### 候选宇宙构成

```text
PHYSICAL_PRODUCER   248
UNBOUND_READ        121
SCHEDULE_ONLY        73
COVERAGE_BOUNDARY    22
BLOCKED_READ          6
ROOT_WRITE            1
bridgeStats          resolved 248 / ambiguous 0 / missing 149
```

### Unknown 原因（合计 2443）

| 原因 | 计数 | 占比 |
| --- | --- | --- |
| `OCCURRENCE_EVIDENCE_NOT_FOUND` | 1499 | 61% |
| `CANDIDATE_BOUNDARY` | 476 | 19% |
| `NOT_REACHED_FROM_ROOT` | 234 | 10% |
| `OTHER` | 132 | 5% |
| `RELATION_SUMMARY` | 102 | 4% |

`relationSummaries`：63 条，`complete` 46/63。

## 推翻的三个结论

**1. 假阳性不存在于这个消费者。** 此前判定的 14 张假阳性表，实测全部是 `UNKNOWN`，
无一进入档一：

| 表 | 生产任务 | 实测状态 |
| --- | --- | --- |
| `t02_pub_covt_const` | 74850 | 全通道 `UNKNOWN` |
| `t01_pty_clas_h` | 105380 | 全通道 `UNKNOWN` |
| `t01_pty_cutp` | 105379 | `FIELD_VALUE=UNKNOWN` |
| `t01_pty_rat` | 104300 | `FIELD_VALUE=UNKNOWN` |
| `t03_agt_clas_h` | 106661 / 144287 | 全通道 `UNKNOWN` |
| `t03_agt_name_h` | 106660 / 144290 | 全通道 `UNKNOWN` |
| `t03_agt_rela_h` | 103935 / 103936 / 105388 | 全通道 `UNKNOWN` |

「81 收到 69」那组数字来自 **field-lineage 的 HTML 可视化**（`OPERATOR_IMPACT` /
`affectedRootFields`），不是 causal-closure 消费者。两个消费者的问题不是同一个：
HTML 侧确实在把算子广播到 97 个字段；causal-closure 侧根本没有这些表的 CONFIRMED。

**2. 已经做完的比预想的多。** 以下都已落地并且是绿的：

- `joinSideChannels()` 已按 CROSS/SEMI/ANTI/FULL/RIGHT/LEFT 分左右返回通道
- `summarizeTaskRelations()` 已用 `descendantReads(left/right)` 分侧施加
- `shrinkReport`（`valueCertain` / `rowDetermining` / `multiplicityRisk` /
  `prunedCount` / `prunedReasons`）已在 artifact 里
- summary 已按四档渲染，档一每条带 `via <字段>` 和 `witness`
- `tests/target-table-upstream-causal-closure/` 30 个测试全通过
- tasks.md 的 5.1、3.4 已是 `[x]`，与实测一致

**3. 119044 档一只挂对了的 5 个值列。** 实测档一：

```text
119044 pdata_n.t98_sb_otc_opt_comp_info
  via book_bel_dept, cutp_pty_shor_name, end_prcg_date, erly_trmt_date, inr_ord_id
```

SQL 里还有 `Book_Agt_Id`——不是输出列，是去 LEFT JOIN 持仓 PEPV 的键。
播种前 `t03_agt_rela_h` 停在 UNKNOWN，是因为 LEFT 可空侧本来就不是
`ROW_MEMBERSHIP`。**不要**把这个键补进档二完成标准；拉链四张 ref 才是档二。

## 真正的问题（仅描述 13:07 冻结点）

不是清单太长，是**这份冻结里 32/59 个任务是 `UNKNOWN`，用户无法据此决定要不要重跑**。

- 档二、档三结构性为空：`ROW_MEMBERSHIP` / `MULTIPLICITY` 的 CONFIRMED 恒为 0。
  拉链路上 163064 / 179886 / 78473 全在 `UNKNOWN` 里。
  （13:51 曾把拉链三张和 LEFT 维表都送进档二；14:17 收口后 LEFT 在档三。
  见下节对照表。）
- 档四 198 条只有计数，没有分类原因。
- 471 branch 对 59 task，分支重复严重。

按冻结规模排序的阻塞点。**第 1 条已被 RS-1a 诊断拆开，不要再当档二根因：**

1. `OCCURRENCE_EVIDENCE_NOT_FOUND` 1499 条是 gap 字符串次数；真正带该 gap 的
   PHYSICAL_PRODUCER 是 222 条，其中 184 条根本没有 VALUE_FLOW。见
   `176827-rs1a-occurrence-diagnosis.md`。1499 **不是**档二为空的原因。
2. `CANDIDATE_BOUNDARY` 476 条（19%）
3. `NOT_REACHED_FROM_ROOT` 234 条（10%）
4. `bridgeStats.missing` 149
5. 分支去重

## 155015 对照（同一引擎，已有产物）

**旧段作废。** 下面那组「档二 empty / conservativeSafetySet」来自更早一次运行，
与当前 `155015.json`（`generatedAt=2026-09-01T14:22:27.382Z`）冲突。
RS-0「与基线证据一致」必须以本段为准，否则会把已经对的 155015 档二判成回归失败。

```text
155015.json  2026-09-01T14:22
档一  {112715, 114026, 71698, 105387}
档二  163064 d_ref_fx_forward
      179886 d_ref_fast_trs
      78472  d_ref_otc_option_deal
      78473  d_ref_trs
      via Agt_Modifr1
档三  empty
```

155015 → 105387 这一跳同时是 `FIELD_VALUE=CONFIRMED`（`stati_cont_desc`）和
`ROW_MEMBERSHIP=CONFIRMED`（`Agt_Id` / `strt_date` / `end_date` / `SRC_TBL`）。
根 hop 把行通道带进了 105387，拉链 CASE 就把四张表证成档二。
`ROOT_RELATION_NOT_FOUND` 在这些 CONFIRMED 评估上照样挂着，**挡不住 CONFIRMED**。

155015 是**规则已经成立的正例**，不是 176827 的小规模同构失败。
后续 155015 档二四张 ref 是回归，不得变空。

## 对照产物不要混（2026-09-01）

| 文件 | 生成时间 | 档二 | 用来干什么 |
| --- | --- | --- | --- |
| `176827-baseline.json` | 13:07 | 空 | 播种前冻结。RS-0 档一 27 个 taskId 对这份 |
| `176827.json`（已被覆盖） | 13:51 | 16 条（拉链三张 + LEFT 维表） | 播种后过宽中间态 |
| `176827.json`（已被覆盖） | 14:17 | 8 条（拉链三张 + 5 条 generic CASE） | LEFT 已出档二的中间态 |
| `176827.json` | 14:22 | 3 条（仅拉链）；LEFT / 103943 子查询在档三 | **现状** |
| `155015.json` | 14:22 | 恰好四张 ref | 规则正例 / 回归 |

176827 到 105387 **不是直连**：`176827 --FV--> 119044 --FV(stati_cont_desc)--> 105387 --拉链--> 四张 ref`。
78472 在 176827 档一是因为 103943 ← `d_ref_otc_option_deal` 供了 `early_term_date`，
不是拉链驱动；`rowDetermining` 排除档一后，拉链路上档二应出现的是
**163064 / 179886 / 78473**。

## 改动后（2026-09-01 22:01，RS-1b + RS-3 + RS-4）

对照 `176827.json` / `155015.json`（覆盖播种后现状，**未改** `176827-baseline.json`）。
未重建 field-lineage，未写 `artifacts/tasks/*`。schema 仍是 `1.2.0`；
`prunedReasons.samples` 与 `shrinkReport` 档三 `joinNode` 为可选字段。

### 176827

耗时 5.1s，`peakMemoryBytes` 579,649,536（约 553MB），未触达 1GiB / 300s。

```text
档一  27/27 与基线 taskId 完全一致，无新增 JOIN 键表
档二  16 条
      该留：163064 / 179886 / 78473  via Agt_Modifr1
      仍在：105388 t03_agt_rela_h via Book_Agt_Id
            以及 102845 / 103937 / 104300 / 105379 / 105380 / 105386
            / 106660 / 106661 / 113992 / 126973 / 142305 / 91256
      74850 t02_pub_covt_const 不在档一/档二
档三  0（默认折叠）
档四  233 本轮证不出（含无 producer 的边界分支）
      UNBOUND_READ 121
      UNCLASSIFIED 81     样本 107938/144288 t03_agt_rela_h、74850 常量表
      COVERAGE_BOUNDARY 22
      BLOCKED_READ 6
      SCHEDULE_ONLY 3
unknownReasons  OCCURRENCE 1499 → 8（RS-1b，同表两读不匹配）
                CANDIDATE_BOUNDARY=222  NOT_REACHED_FROM_ROOT=234
taskRollup      CONFIRMED_RELATED 53 / UNKNOWN 6（基线 27 / 32）
summary         同一 (task, table) 不重复
文案            「本轮证不出 / 未进入确定集」；无「已剪除 / 无关 / 无影响」
```

档四 233 与 UNKNOWN gap 字符串不是同一人群。旧「84」只计有
`producerTaskId` 且未进档一/二/三的 assessment；RS-4 把
`UNBOUND_READ` / `BLOCKED_READ` / `COVERAGE_BOUNDARY` 一并纳入。
`UNCLASSIFIED` 81 条主要是同表 CANDIDATE/UNKNOWN 写入方未闭环，
不是「已证不相交」。分区谓词（RS-6）尚未消费。

### 155015（回归）

耗时 3.5s，约 477MB。

```text
档一  105387, 112715, 114026, 71698
档二  163064 d_ref_fx_forward
      179886 d_ref_fast_trs
      78472  d_ref_otc_option_deal
      78473  d_ref_trs
      via Agt_Modifr1
档三  0
档四  32：UNBOUND_READ 14 / UNCLASSIFIED 10 / COVERAGE_BOUNDARY 6
          / BLOCKED_READ 1 / SCHEDULE_ONLY 1
144289 不在档一/档二
```

### 仍未达到方案第 9 节「解决」（对 22:01 那一跑）

拉链三张已在档二，155015 四张 ref 未丢，档四有稳定原因码，预算未触达。
**当时 176827 档二仍含 LEFT 可空维表**（含 `t03_agt_rela_h`）。
那是播种过宽，不是 RS-4 回归。见下一节 14:17 收口。

## 改动后（2026-09-01 14:17，RS-3 收口）

对照当前 `176827.json` / `155015.json`（覆盖 13:51 / 13:53，**未改** `176827-baseline.json`）。
去掉 donor 升级；值召回跳本地有拉链 CASE（`EXPRESSION_CONTROL` 不是 N/A）才问 RM，
问的时候挂在 `FIELD_VALUE` 上。夹具 41/41 绿。未改 `joinSideChannels()`，
未接 `BRANCH_SELECTOR`，未勾 2.3。

### 176827

`generatedAt=2026-09-01T14:17:03.825Z`，`peakMemoryBytes` 569,839,616（约 544MB），
未触达 1GiB / 300s。

```text
档一  27/27 与基线 taskId 完全一致；78472 留在档一
档二  8 条
      该留：163064 / 179886 / 78473  via Agt_Modifr1
      仍在（RS-5 验收判断，不是 RS-3 漏项）：
            102845 d_ref_option_deal_pr
            113992 d_ref_option_deal_barrier
            126973 d_trd_option_limit_audit
            91256  d_trd_otc_contr_props
            78349  d_ref_instrument
            消费方 103943 / 103234 上同一套 IS NOT NULL CASE 启发式
档三  9 条 LEFT 维表：105388 t03_agt_rela_h、t01_pty_*、t03_agt_clas_h
      / t03_agt_name_h / t03_agt_prd_rela_h / t03_agt_stat_h / ref_dw_cd_val
档四  230 本轮证不出
      UNBOUND_READ 121 / UNCLASSIFIED 79 / COVERAGE_BOUNDARY 22
      / BLOCKED_READ 6 / SCHEDULE_ONLY 2
unknownReasons  OCCURRENCE=10  CANDIDATE_BOUNDARY=222  NOT_REACHED_FROM_ROOT=234
taskRollup      CONFIRMED_RELATED 53 / UNKNOWN 6
```

### 155015（回归）

`generatedAt=2026-09-01T14:17:35.170Z`。档一仍是 `{112715, 114026, 71698, 105387}`；
档二四张 ref 经 `Agt_Modifr1`，没有变空。档三 0。档四 32。

### RS-5 当时未勾（对 14:17 那一跑）

第 9 节里「拉链三张 + LEFT 不在档二 + 155015 回归」已满足。
剩 5 条 CASE 启发式要不要再收，是验收判断，不是 7b.6 漏项。见下一节 22:22：已收、7b.8 已勾。

## 改动后（2026-09-01 22:22，RS-3 再收 generic CASE）

对照当前 `176827.json` / `155015.json`（覆盖 14:17，**未改** `176827-baseline.json`）。
generic CASE/IF/COALESCE 不再给子孙 read 打 `EXPRESSION_CONTROL`；拉链仍只走 `existenceCaseSelections()` 的 IS NOT NULL CASE。夹具 43/43 绿。未改 `joinSideChannels()`，未接 `BRANCH_SELECTOR`，未勾 2.3。未提交。

### 176827

`generatedAt=2026-09-01T14:22:11.993Z`，`peakMemoryBytes` 578,809,856（约 552MB），未触达 1GiB / 300s。

```text
档一  27/27 unique taskId 与基线一致；78472 留在档一（early_term_date）
档二  3 条（仅拉链）
      163064 odata_n_tit.d_ref_fx_forward  via Agt_Modifr1
      179886 odata_n_tit.d_ref_fast_trs    via Agt_Modifr1
      78473  odata_n_tit.d_ref_trs         via Agt_Modifr1
      不含 105388 t03_agt_rela_h / t01_pty_* / t03_agt_* / ref_dw_cd_val
           / 102845 d_ref_option_deal_pr / 113992 barrier / 126973 limit_audit
           / 91256 contr_props / 78349 d_ref_instrument
档三  13（LEFT 维表 + 103943 LEFT 子查询，默认折叠）
档四  233 本轮证不出
      UNBOUND_READ 121 / UNCLASSIFIED 81 / COVERAGE_BOUNDARY 22
      / BLOCKED_READ 6 / SCHEDULE_ONLY 3
runtimeRerunDecision  NOT_EVALUATED
```

### 155015（回归）

`generatedAt=2026-09-01T14:22:27.382Z`。档一仍是 `{112715, 114026, 71698, 105387}`；
档二四张 ref 经 `Agt_Modifr1`，没有变空。档三 0。档四 32。

7b.6 / 7b.8 已勾。RS-6 未开工。
