# 重跑上游收缩：执行方案

配套：`docs/execution-plan-asset-graph.md` 是业务地图的路。P0 RS-5 已过，WP-1 可以领。
本文件只解决一件事：**已知一张表要重跑，给出真正有影响的上游清单，每条都有理由。**

金样是 `176827`（规模）与 `155015` / `105387`（规则）。
工作落在已有 change `openspec/changes/target-write-upstream-causal-closure`，
不新开 WP，不另起通道词典。没有任务个数指标。

**对照产物（都在 `sql-static-lineage-artifacts/target-table-causal-closure/`，不要混用）：**

| 文件                              | 生成时间 | 用来干什么                                                            |
| --------------------------------- | -------- | --------------------------------------------------------------------- |
| `176827-baseline.json`            | 13:07    | **播种前**冻结点：档二空、RM CONFIRMED=0、UNKNOWN 32、OCCURRENCE 1499 |
| `176827.json`（中间态，已被覆盖） | 13:51    | 播种后过宽：档二 16 条，拉链三张已在，LEFT 维表误入                   |
| `176827.json`（中间态，已被覆盖） | 14:17    | LEFT 已出档二；档二仍有 5 条 generic CASE 子查询                      |
| `176827.json`                     | 14:22    | **现状**：档一 27；档二仅拉链三张；LEFT / 103943 子查询在档三         |
| `155015.json`                     | 14:22    | **规则正例 / 回归**：档二恰好四张 ref，经 `Agt_Modifr1`               |

基线证据文件必须跟这几份对齐。RS-0 的「与基线一致」指档一 27 个 taskId 对 `176827-baseline.json`；
155015 档二四张 ref 是回归，**不得把旧的空档二当金样**。`176827-baseline.json` 未改。

---

## 1. 起点：规则在 155015 已经成立；RS-3 已把 LEFT 维表送出档二

`176827` 写 `dm_rsk_n.otc_opt_greek_val_det_h`，97 个输出字段。

**播种前（`176827-baseline.json` 13:07）：** 档一 27 任务可用，档二空，32/59 UNKNOWN。
field-lineage HTML 的「81→69」是另一个消费者，不要再当本方案的问题。

**播种后中间态（13:51，已被覆盖）：** 拉链三张进了档二，LEFT 维表也进来了。

**RS-3 收口后（`176827.json` 14:22）：**

```text
档一  27 任务不丢；78472 留在档一
档二  3 条，仅拉链：163064 / 179886 / 78473   via Agt_Modifr1
档三  LEFT 维表 + 103943 generic CASE 子查询（默认折叠）
```

78472 在档一，是因为 103943 ← `d_ref_otc_option_deal` 供了 `early_term_date`，
不是拉链驱动表。`rowDetermining` 排除档一 taskId 后，拉链路上 176827 档二应出现的
只有 **163064 / 179886 / 78473**。那三条已经在。

**155015 不是小规模同构失败。** 现有 `155015.json` 档二已经是：

```text
163064 d_ref_fx_forward
179886 d_ref_fast_trs
78472  d_ref_otc_option_deal
78473  d_ref_trs
via Agt_Modifr1
```

155015 → 105387 这一跳同时是 `FIELD_VALUE=CONFIRMED`（`stati_cont_desc`）和
`ROW_MEMBERSHIP=CONFIRMED`（`Agt_Id` / `strt_date` / `end_date` / `SRC_TBL`）。
根 hop 把行通道带进了 105387，拉链 CASE 就能往四张表传。
`ROOT_RELATION_NOT_FOUND` 在这些 CONFIRMED 评估上照样挂着，**挡不住 CONFIRMED**。
155015 是规则正例；176827 要做的不是再发明拉链语义。

### 链比「176827 → 105387」深一跳

176827 到 105387 **不是直连**。第一跳 CONFIRMED 全是值通道，没有 105387：

```text
176827  --FV-->  119044 t98_sb_otc_opt_comp_info
                 --FV(stati_cont_desc)-->  105387 t03_agt_stati_info_h
                                           --拉链 CASE-->  163064 / 179886 / 78473 / 78472
```

只改根节点 `demandedFieldNames: []`、只在第一跳接 `FIELD_VALUE → ROW_MEMBERSHIP` 桥，
到不了拉链：第一跳是 119044，不是 105387。
**值链上每一跳都要把「这份值是哪一行/哪个版本」问进去**，至少穿过 119044。

`176827.json`（14:22）里这条链已经把拉链三张送进档二；LEFT 维表和 103943
generic CASE 子查询在档三。generic CASE 不再给子孙 read 打 `EXPRESSION_CONTROL`，
拉链只走 `existenceCaseSelections()` 的 IS NOT NULL CASE。

### JOIN 侧别、拉链 CASE、3.4 都不要再动

1. `joinSideChannels()` 已是 LEFT 保留侧 `ROW_MEMBERSHIP`、可空侧不含。
   测试已钉住。不要改回去。
2. 拉链 CASE 走 `existenceCaseSelections()`（`IS NOT NULL`），夹具已绿。
   不要再接 `BRANCH_SELECTOR`。
3. 119044 档一只挂 5 列，3.4 已生效。缺的 `Book_Agt_Id` 是 LEFT 键，
   **不是档二**（见下节）。
4. 「81→69」来自 field-lineage HTML 广播，不是这个消费者。

### 档二该留什么、不该留什么

| 依赖                                                       | 通道                               | 档                                         |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| 105387 拉链四张 ref（176827 上是 163064 / 179886 / 78473） | `ROW_MEMBERSHIP` 经 `Agt_Modifr`   | 档二                                       |
| `t03_agt_rela_h` / `Book_Agt_Id`                           | LEFT 可空侧键，最多 `MULTIPLICITY` | 档三或仍 UNKNOWN，**不要写进档二完成标准** |
| 119044 未使用维表（`t01_pty_*` / `t03_agt_clas_h` 等）     | 同 LEFT 可空侧                     | 不得进档一/档二                            |

`Book_Agt_Id` 是 176827 去 LEFT JOIN 持仓/119044 的键。LEFT 可空侧按现行规则
**不是** `ROW_MEMBERSHIP`。改这个键会改维表配上哪一行（值 / 倍增），不会删
176827 的驱动行。拉链四张表不同：它们决定 105387 输出的是哪个版本，再变成
119044/176827 读到的 `stati_cont_desc`。那才是档二。

RS-3 / RS-5 已过：档二只留拉链三张。LEFT 维表和 generic CASE 子查询在档三。

---

## 2. 解决之后长什么样

给调度的是分档清单，每条带通道和经哪个字段。

```text
档一 值必达     改了一定改这份输出的值
档二 行决定     不改值，改这份输出能读到哪些行 / 哪个版本
档三 倍增风险   可空侧 JOIN，无法证明多对一；不单独构成必查，默认折叠
档四 本轮证不出 必须带分类原因；禁止用「值链上没找到」当作无关的证明
```

排查顺序：档一 → 档二 → 档三。档四不展示为「无关」。

**176827 完成的判据**（不看个数）：

- 档一保持现有 27 个任务不丢。
- 档二含 `163064` / `179886` / `78473`，理由「经 `Agt_Modifr`」。78472 留在档一。
- 档二**不含** LEFT 可空维表：`t03_agt_rela_h`、`t01_pty_*`、`t03_agt_clas_h` /
  `t03_agt_name_h` / `t03_agt_prd_rela_h` / `t03_agt_stat_h`、`ref_dw_cd_val` 等。
  这些最多进档三。也不含 103943 generic CASE 子查询。14:22 已满足。
- 档四按稳定原因码分类。文案只能是「本轮证不出 / 未进入确定集」。
- summary / rollup 里同一 `(task, table)` 只出现一次；`assessments` 数量与键不变。
- 未触达现有 1GiB / 300s 预算。不得以「比 13:07 基线更快」判失败。
- `runtimeRerunDecision` 保持 `NOT_EVALUATED`。

**UNKNOWN 下降已经发生过一次**（32→6，伴随档二过宽）。后续再降必须能归因，
且不得靠把 LEFT 维表标成档二来实现。

**155015 完成的判据（回归，不是新能力）：** 档一仍是 `{112715, 114026, 71698, 105387}`；
档二仍是四张参考表经 `Agt_Modifr1`。**不得变空。**

**关于落点的诚实预期。** 整表重跑问「谁影响这 97 列」，答案本身就是几十个任务。
本方案让每条站得住、让档二能证拉链，不会把清单变成个位数。

按列反查（RS-0.5）能把 27 收到 1–5，但**只在你能说出哪列不对时有用**。
不传列名就等于不过滤，整表答案不变。两者是不同场景：
整表重跑走主线，指标数字不对走 RS-0.5。**RS-0.5 在方案内，但不算主线交付**——
不要拿它的短清单当整表收缩的成绩。

---

## 3. 105387 拉链（规则金样）

来源：`sql-static-lineage-data/field-facts/input-pack-sources/105387/multi-*.sql`。
实测事实：105387 有 4 个 LEFT + 1 个 FULL join，24/24 `condition_columns` 全 `PHYSICAL`。

```sql
SELECT
  A.KEY_OTC_TRADE_ID AS Agt_Id1
, CASE WHEN B.KEY_OTC_TRADE_ID IS NOT NULL THEN '20206'
       WHEN C.KEY_OTC_TRADE_ID IS NOT NULL THEN '20207'
       WHEN D.KEY_OTC_TRADE_ID IS NOT NULL THEN '20208'
       WHEN E.KEY_OTC_TRADE_ID IS NOT NULL THEN '20206'
       ELSE '' END AS Agt_Modifr1
, INTERNAL_TRADE_ID AS Stati_Cont_Desc1
FROM      D_TRD_OTC_TRADE A
LEFT JOIN D_REF_TRS B / D_REF_OTC_OPTION_DEAL C / D_REF_FX_FORWARD D / D_REF_FAST_TRS E
  ON A.KEY_OTC_TRADE_ID = *.KEY_OTC_TRADE_ID
```

```sql
FROM (历史开链 AND SRC_TBL IN ('ODATA_N_TIT.D_TRD_OTC_TRADE')) A
FULL OUTER JOIN TEMP.T03_AGT_STATI_INFO_H_TEMP_TIT165 B
  ON  A.Agt_Id = B.Agt_Id1 AND A.Agt_Modifr = B.Agt_Modifr1
```

`Stati_Cont_Desc` 的值只来自 `INTERNAL_TRADE_ID`。四张参考表不供值，但决定
`Agt_Modifr`，从而决定拉链匹配与 `STRT_DATE`/`END_DATE`。下游按这两列过滤时，
它们是行决定。

**summary 层已经够用**：`existenceCaseSelections()` 已把 `IS NOT NULL` CASE
标成 `EXPRESSION_CONTROL` + `ROW_MEMBERSHIP`，夹具已绿。
**155015 已经证明**：只要上游节点上有 `ROW_MEMBERSHIP`，同一套 CASE 就能把四张表
证成档二。RS-3 已收口：值召回跳本地有拉链 CASE 才问 RM，LEFT 维表不再进档二。

对比 176827 根上的 `t02_pub_covt_const`：不进拉链、不决定驱动行。规则必须分开
这两种 LEFT JOIN——summary 层已经分开了。

---

## 4. 事实侧默认不改（实测）

探针读 `field-facts/registry/tasks/<id>/bundle/`：

| 任务   | join 节点 | join_type         | 有 left+right | `condition_columns` |
| ------ | --------- | ----------------- | ------------- | ------------------- |
| 176827 | 16        | LEFT×10 / INNER×6 | 16/16         | 82/82 `PHYSICAL`    |
| 119044 | 15        | LEFT×15           | 15/15         | 96/96 `PHYSICAL`    |
| 105387 | 5         | LEFT×4 / FULL×1   | 5/5           | 24/24 `PHYSICAL`    |

`field-expression-nodes.jsonl`：176827 有 1312 个节点带 `input_fields` 且
`input_dependency_status = PHYSICAL`，`unresolved_input_columns` 全为 0。
119044 的 `expression_roles` 为 0，但其 SQL 中 CASE / NVL / COALESCE 各 0 次，属正确。

**边界写死**：本方案默认不碰事实生产。RS-1a 诊断已排除「两套 matcher /
facts 里 id 拼错」为主因。不要为了消 OCCURRENCE 去改 facts。

---

## 5. 硬约束

违反其一即失败。

1. 不改 SQLLens、`scripts/plans/`、`scripts/machine-facts/` 的事实生产。
   RS-1a 已排除 facts 拼 id 为主因；不要再借 OCCURRENCE 去改 facts。
2. 不引入新解析器。
3. 不生成 `PROVEN_UNRELATED` / `PROVEN_ABSENT`。值链没找到路径 ≠ 无关。
4. 不得把 `ROW_MEMBERSHIP` 投影成字段节点上的 `affectedRootFields`。
5. `FIELD_VALUE = CONFIRMED` 不被独立的 `MULTIPLICITY = UNKNOWN` 降级。
6. `runtimeRerunDecision` 保持 `NOT_EVALUATED`。
7. 旧 field-lineage / one-hop / multi-hop 的产物、哈希、CLI 行为不变。
8. 默认测试与生产命令不依赖 Java/Calcite。
9. 主 assessment 键仍是 `targetWriteId + candidateBranchId`，禁止字段 × 分支笛卡尔积。
   **禁止为了「接近任务数量级」去压缩 `assessments`。**
10. 通道词典不平行发明。
11. **档一 27 个任务是回归基线。** 任何改动不得让它们掉出档一。
    **LEFT 可空维表不得进档二**（`t03_agt_rela_h` 不是档二完成标准）。
12. **UNKNOWN 变少必须来自原因被解决。** 触达现有预算上限即判失败。
    不得用把 LEFT 维表标成档二来换 UNKNOWN 下降。
    不得用「比不完整分析更慢」判失败。

**对比脚本忽略时间戳。** artifact 含 `generatedAt`，`contentHash` 是对含时间戳
的整包做的。完成定义一律改成：去掉 `generatedAt` / `stages` 耗时之后比，
或只比档位 + `unknownReasonCounts` + 档一 taskId 集合。不要写「逐字节一致」
或「`contentHash` 不变」。

---

## 6. 工作包

按实测阻塞规模排序，不按此前的猜测。

```text
RS-0     基线改成承认 155015 档二已有四张 ref；176827-baseline 档二仍空
RS-0.5   按列过滤档一（不算主线）
RS-1a    评审已有诊断 176827-rs1a-occurrence-diagnosis.md，不要再做一遍两套 matcher
RS-1b    改 gap 标签（可选，不影响档二）
RS-2     summary/rollup 去重
RS-3     **已收口（7b.6）**：值链递归；本地有拉链 CASE 才问 RM；LEFT 维表进档三
         完成标准已满足：163064 / 179886 / 78473 在档二，t03_agt_rela_h 不在
RS-4     档四归因
RS-5     **已过（7b.8，14:22）**：档二仅拉链三张；155015 四张 ref 仍在
RS-6     分区谓词，条件启动
```

### RS-0 基线固化

**目标**：让任何 agent 一条命令复现基线，并把对比变成机械动作。

**改动**

- 新增 npm script（或 `scripts/` 下小工具）封装 176827 / 155015 两条运行，
  含 `--write-observation-id`。当前必须手动从 `dataset-io.jsonl` 找这个值，
  是主要摩擦点。
- 让 CLI 在**恰好一条** `direction=write && field_producing=true` 记录时自动采用它；
  多条仍 fail-fast 成 `TARGET_WRITE_AMBIGUOUS`。不改变现有显式传参行为。
- 新增对比脚本：读两个 artifact，去掉 `generatedAt` / `stages` 耗时后，
  输出档一/档二/档三/档四 taskId 集合、`unknownReasonCounts`、
  是否触达预算上限、`peakMemoryBytes` 的差异表。

**完成定义**

1. 一条命令跑出 176827，档一 27 个 taskId 与 `176827-baseline.json` 一致。
2. 对比脚本能指出档一是否丢任务、档二 taskId 集合、UNKNOWN 各原因增减。
3. 155015 档二四张 ref 被当成回归基线写入证据文件，旧的「档二 empty」作废。
4. 既有测试仍绿。

### RS-0.5 按列过滤档一（不是主线）

**先说清它不解决什么。** 整表重跑问「谁影响这 97 列」时，不传列名 = 不过滤 =
仍然是今天的 27 个任务。**它对整表场景没有任何收缩作用。**

它只在一种场景有用：**你已经能说出哪个指标 / 哪列数字不对**。那时它把 27 收到
通常 1–5 个任务。实测支撑：档一 27 个任务里 15 个只影响 1 列。

**为什么便宜**：每条 assessment 的 `FIELD_VALUE` 通道已经带
`affectedTargetFields`，数据在 artifact 里。这是纯输出层过滤，不改推理、
不改 assessment 键、不改产物 schema。

**改动**

- CLI / 对比脚本加可选 `--target-field <col>[,<col>...]`。
- 不传时行为与今天完全一致（回归要求：档位 + taskId 集合一致）。
- 传入时只过滤档一/档二/档三的**展示**，`assessments` 不变。
- 列名不存在于该目标表时 fail-fast，不静默返回空。

**完成定义**

1. 不传列名时档位与档一 taskId 集合与基线一致（忽略 `generatedAt` / `stages`）。
2. `--target-field delta` 在 176827 上只列出供 `delta` 相关列的任务。
3. 传入全部 97 列时结果等于不传。

### RS-1a 评审已有诊断（不要再做一遍）

**状态：待评审的已完成。** 产出已在
`openspec/changes/target-write-upstream-causal-closure/176827-rs1a-occurrence-diagnosis.md`。
不要再开一轮 `sameOccurrence` vs `occurrenceTokenMatches`。那会把下一棒带去改匹配，
而 1499 **不是**档二为空的原因。

采信该诊断（默认）。推翻必须写明为什么 184/222（83% 无 VALUE_FLOW）那张表是错的：

- 真正带这条 gap 的 PHYSICAL_PRODUCER 是 **222** 条，不是 1499
- **184 / 222（83%）** 这对根本没有 VALUE_FLOW（LEFT 维表），却被标成
  `OCCURRENCE_EVIDENCE_NOT_FOUND`
- token 对不上只有十几条；两套匹配函数不是主因
- 105387 → 四张 ref 的 RM 终态 gap 是 `ROOT_RELATION_NOT_FOUND` / `NO_CLOSED_PATH`，
  不是 OCCURRENCE

**完成定义**：评审记录进基线证据：采信 / 不采信 + 理由。不改代码。不重跑直方图。

### RS-1b 改 gap 标签（可选，不影响档二）

**领取前置**：RS-1a 评审采信诊断。不开本项不算主线失败。

范围就是诊断里的三条，不要再扩成「先看两套 matcher」：

1. 无 VALUE_FLOW → `FIELD_VALUE = NOT_APPLICABLE`，不要写 OCCURRENCE
2. 有 VALUE_FLOW 但无 consumer-read token → 单独 gap，或按 (任务, 表) 回退
3. `unknownReasonCounts` 按 assessment 去重，不要把 fan-out 兄弟 gap 加进计数

**不要做：** 重构 occurrence 身份、用表名模糊匹配、为了消 1499 去改传播图。

**完成定义**

1. 下降能归因到上面三类，不是整体消失。
2. 档一 27 个任务全在。档二对 155015 / 拉链三张不回归。
3. 不新增 `PROVEN_*`。不触达现有预算上限。

### RS-2 summary / rollup 去重

**目标**：471 branch / 59 task，`t01_pty_clas_h` 出现约 14 次、
`d_ref_otc_option_deal` 13 次。重复让输出难读。

**写死**：只在 summary / rollup / `shrinkReport` 输出层按 `(task, table)` 合并。
`assessments` 数量、键、`candidateBranchId` 全部不变。第 2 节「接近任务数量级」
指的是给人看的清单，不是压缩内部 assessment。

`buildShrinkReport()` 已经按 `(taskId, table)` 合并过档一/档二/档三条目。
RS-2 要修的是 summary 文本仍按 branch 展开、以及 `taskRollup` 是否按表拆行。

**完成定义**

1. summary 里同一 `(task, table)` 只出现一次，witness 合并不丢。
2. `assessments` 数量与键不变。
3. 不触达现有预算上限。

### RS-3 值链递归问行决定（tasks.md 7b.6）— **已收口**

没有改 `joinSideChannels()`，没有接 `BRANCH_SELECTOR`，也没有勾 2.3。
去掉 donor 升级之后，单元测试绿。

**实际落地（不是补一次桥）：** 值召回跳只做两件事：

- 本地有拉链 CASE（`EXPRESSION_CONTROL` 不是 N/A）才问 RM
- 问的时候挂在 `FIELD_VALUE` 上，不继承父节点可能是 UNKNOWN 的 RM

13:51 过宽的根因：119044 被根上 INNER JOIN 打上 RM 后，同一通道把 RM 传给了
只有版本窗 FILTER、没有拉链 CASE 的 LEFT 维表。收口后那些表进了档三。

**176827 真实跑（`176827.json` 14:22）：**

- 档一仍是 27 个任务，`78472` 留在档一
- 档二仅拉链三张：`163064` / `179886` / `78473`，经 `Agt_Modifr1`
- LEFT 维表和 103943 generic CASE 子查询出了档二，进了档三

**155015 回归：** 档二四张 ref 还在，没有变空。夹具 43/43 绿。
`176827-baseline.json` 未改。7b.6 / 7b.8 已勾。

### RS-4 档四归因（198 条）

**目标**：档四现在只有计数。按硬约束 3 它不能暗示「无关」，所以必须带原因。

**两个人群不要混：** 198 条是档四 assessment；2443 是 UNKNOWN 的 gap 字符串。
`prunedReasons` 现在取 `gapRefs[0]` 最后一段，分类会很碎。RS-4 要换成稳定的
原因码，不要用「其它 ≤ 10%」这种经不起机械核对的门槛。

**改动**

- 把 `prunedReasons` 收成稳定集合：无 producer bridge、覆盖边界、
  `SCHEDULE_ONLY`、`UNBOUND_READ` / `BLOCKED_READ`、未建模算子、
  分区谓词无交集（RS-6 之后才有）、其余记 `UNCLASSIFIED` 并带样本。
- summary / HTML 按原因分组展示计数 + 样本，不展开全部。
- 档三按 `(任务, JOIN 节点)` 粒度带 witness（哪些键、为什么证不出多对一），
  默认折叠。**档三不按列约束**——行数放大影响整行，逼它说「哪些列」会产生假精度。
- 档四标题与文案改为「本轮证不出 / 未进入确定集」，禁止「无关 / 无影响」。

**完成定义**

1. 每条档四 assessment 都落到上面的稳定原因码；`UNCLASSIFIED` 必须带样本，
   不设百分比上限。
2. 档四文案不含任何「无关 / 无影响」措辞。
3. schema 变更保持旧版本可读。

### RS-5 验收

只读已有 Input Pack / Facts / `artifacts/tasks/{176827,155015}/`，不重建 field-lineage。
不写 `artifacts/tasks/*`。证据追加到
`openspec/changes/target-write-upstream-causal-closure/176827-baseline-evidence.md`
的「改动后」小节，与基线并列对比。

**领取**：RS-2 + RS-4。RS-1b **不是**前置。**本项已勾（14:22）。**

**完成定义（第 2 节主线判据，14:22 已满足）：**

1. 档一 27 个任务不丢。
2. 176827 档二仅 `163064` / `179886` / `78473`，经 `Agt_Modifr`；
   **不含** LEFT 维表，也不含 103943 generic CASE 子查询。
3. 155015 档二四张 ref 是回归，**不得变空**。
4. 档四有稳定原因码。
5. summary 同一 `(task, table)` 不重复。
6. 未触达现有时间 / 内存预算。

**若 RS-1b 已合入**，追加：UNKNOWN 相对 `176827-baseline.json` 下降且能归因。
不得靠把 LEFT 维表标成档二来换 UNKNOWN 下降。

### RS-6 分区谓词（条件启动）

`SRC_TBL='…'` 已写在 SQL 里（119044 每个 LEFT JOIN、176827 三个 INNER 驱动都带）。
消费它可以让同表多写入方不再全部进清单。

**条件启动**：RS-1b 之后，或决定不开 RS-1b 时单独评审。RS-1a 诊断已落盘，
不必再等 matcher 结论。当前冻结里 `CANDIDATE_BOUNDARY` 是 476 条、
`bridgeStats.missing` 是 149，分区谓词能吃掉多少要看剩余分布。不要在没有
数据支撑时先做。

---

## 7. 明确不做

- 不改 field-lineage 生产与旧 HTML。**注意**：HTML 侧的 `affectedRootFields`
  广播（37 算子 × 97 字段）是真问题，但属于另一个消费者，归 WP-1，不在本方案。
- 不改 `joinSideChannels()`，不把已绿的侧别断言改回去。
- 不铺任务局部图、不上 Neo4j。
- 不采集指标口径、不跑 LLM。
- 不开放 M5/M6（WINDOW、Calcite）。176827 的失败不在那里。
- 不把静态清单当成运行期重跑指令。
- 不设「任务数 ≤ N」一类指标。
- **不重构 occurrence 模型，也不再查两套 matcher。** RS-1a 诊断已落盘。
- 不把 LEFT 可空侧键（`Book_Agt_Id` / `t03_agt_rela_h`）做成档二。
- 不把 JOIN 键并进 `FIELD_VALUE` 需求。

本方案 RS-5 已过，地图方案从 WP-1 继续；WP-3 必须读取这里的 `TaskRelationSummary`。
`execution-plan-asset-graph.md` 的 P0 段落必须与本文件一致，不得继续写「81 收到 69」。

---

## 8. 领取

| 包     | 领取条件                                                                      |
| ------ | ----------------------------------------------------------------------------- |
| RS-0   | 立即。先改证据文件承认 155015 档二已有四张 ref                                |
| RS-0.5 | RS-0 合入。可与 RS-1a 评审并行。**不算主线交付**                              |
| RS-1a  | **评审已有诊断**，不要再做一遍两套 matcher                                    |
| RS-1b  | RS-1a 采信之后可选。范围=诊断三条。不开不算主线失败                           |
| RS-2   | RS-0 合入，可与 RS-1b 并行（只改 summary/rollup，不改传播、不改 assessments） |
| RS-3   | **已收口（7b.6）**。LEFT 维表不得进档二；不要当未做包再领                     |
| RS-4   | RS-3 合入                                                                     |
| RS-5   | **已勾（7b.8，14:22）**。档二仅拉链三张；LEFT / generic CASE 子查询在档三     |
| RS-6   | RS-1b 之后（或决定不开 RS-1b 时单独评审）按剩余 UNKNOWN 分布决定              |

每个包合入前：`npm run test:target-table-causal-closure`、`npm run typecheck`，
并跑 RS-0 的对比脚本确认档一不丢、预算未触达。

---

## 9. 何时算解决

档一 27 个任务不丢；176827 档二仅拉链三张；155015 档二四张 ref 仍在；
档四有分类原因；未触达现有预算。**14:22 已满足，7b.8 已勾。**

**不算解决**：清单变短但触达预算上限；拉链三张掉出档二；LEFT 维表进了档二；
`t03_agt_rela_h` 被写成档二完成标准；档四仍只有计数；或以「任务数降到 N」
交付而说不出每条的通道与字段。

**不算主线失败**：不开 RS-1b。UNKNOWN 保持基线 32，或播种过宽收口后的数。

**也要接受**：整表重跑的落点仍是几十个任务。按列反查（RS-0.5）在方案内，
但不算主线交付。

P0 RS-5 已过，地图方案 WP-1 可以领。RS-0 复现脚本、RS-0.5 按列过滤、RS-6 仍未做。
