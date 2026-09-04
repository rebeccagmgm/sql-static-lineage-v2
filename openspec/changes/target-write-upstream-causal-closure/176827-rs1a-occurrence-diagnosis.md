# RS-1a：`OCCURRENCE_EVIDENCE_NOT_FOUND` 诊断（176827）

对照产物：诊断时档二仍空的 176827 快照（OCCURRENCE 1499）。
现盘 `176827.json`（14:22）档二仅拉链三张；LEFT 维表已出档二。13:51 / 14:17 中间态已被覆盖。
**不影响下面的 222 / 83% 结论**。本文件只诊断，不改引擎。默认采信；推翻须写明为什么那张表是错的。

## 结论

**根因是局部标签和计数方式，不是 occurrence 模型要重构。**

`unknownReasonCounts.OCCURRENCE_EVIDENCE_NOT_FOUND = 1499` 不能当成 1499 次
「读 occurrence 对不上」。它是 `field-value-provider.ts` 在
**没有匹配到 VALUE_FLOW** 时一律写下的同一条 gap，再被 fan-out 的
write-observation 兄弟分支复制进 `assessment.gapRefs`。

真正带这条 gap 的 PHYSICAL_PRODUCER assessment 是 **222 条**。
按「field-lineage 里有没有这对 consumer/producer/表的 VALUE_FLOW、token 能不能对上」
分类如下。

## 计数膨胀

| 口径 | 数量 |
| --- | --- |
| metrics `OCCURRENCE_EVIDENCE_NOT_FOUND` | 1499 |
| 含该 gap 的 assessment | 222 |
| 每条 assessment 上该 gap 的条数 | 1–11，平均 6.86 |

原因有两层：

1. **错标签。** `field-value-provider` 找不到 VALUE_FLOW 时写
   `OCCURRENCE_EVIDENCE_NOT_FOUND`，包括「这张表根本不供值」的 LEFT 维表。
2. **兄弟写入复制。** 同一读 occurrence fan-out 成多条
   `write-observation:…:3` / `:6` 之后，一条 assessment 的 `FIELD_VALUE.gapRefs`
   会带上其它 branchId 的同名 gap。样本 `105388 ← 103935 / t03_agt_rela_h`
   一条 FIELD_VALUE 上有 11 条 OCCURRENCE gap。

因此「修 occurrence 模型」吃不掉这 1499；先改标签和 gap 归属，计数会自己掉下来。

## 直方图（222 条 assessment）

按 `(消费任务, 表, branchKind, 缺失类别)` 头部：

| 条数 | 消费任务 | 表 | 类别 |
| --- | --- | --- | --- |
| 40 | 105388 | `pdata_n.t03_agt_rela_h` | 该对无 VALUE_FLOW |
| 16 | 106661 | `pdata_n.t03_agt_clas_h` | 该对无 VALUE_FLOW |
| 16 | 106660 | `pdata_n.t03_agt_name_h` | 该对无 VALUE_FLOW |
| 9 | 103943 | `odata_n_tit.d_trd_otc_contr_props` | 该对无 VALUE_FLOW |
| 8 | 105386 | `pdata_n.t03_agt_prd_rela_h` | 该对无 VALUE_FLOW |
| 8 | 105387 | `pdata_n.t03_agt_stati_info_h` | VALUE_FLOW 无 occurrence token |
| 8 | 105387 | `pdata_n.t03_agt_stati_info_h` | 该对无 VALUE_FLOW |
| 8 | 103937 | `pdata_n.t03_agt_stat_h` | 该对无 VALUE_FLOW |
| 8 | 105380 | `pdata_n.t01_pty_clas_h` | 该对无 VALUE_FLOW |
| 8 | 105385 | `pdata_n.t03_agt_stati_info_h` | VALUE_FLOW 无 occurrence token |
| 4 | 119044 | `t03_agt_clas_h` / `t03_agt_rela_h` / `t03_agt_name_h` | 该对无 VALUE_FLOW |
| 4 | 176827 | `pdata_news_n.t02_tit_scr_base_info` | token 即使用 relation 尾巴也对不上 |

按类别合计：

| 类别 | assessment | 含义 |
| --- | --- | --- |
| 该对无 VALUE_FLOW | **184（83%）** | field-lineage 没有这条 consumer→producer→表的值边。不是 id 拼错。 |
| VALUE_FLOW 无 occurrence token | 16 | 边在，但 `evidenceRefs` 没有 `field-lineage:consumer-read:…`，provider 建索引时直接跳过。 |
| token 即使用尾巴也对不上 | 13 | 同表两次读（如 `setop.b0` vs `setop.b1`），occurrence 级匹配按设计拒绝。 |
| 表面像 exact 应对上 | 7 | 索引 token 已是 `occurrenceId:readRelationId`；优先当表格键/fan-out 问题，不升格成模型。 |
| 同任务对、表键不一致 | 2 | `stableTableId\|qualifiedName` 两边拼出来不一样。 |

field-lineage 自身：441 条 VALUE_FLOW 里 **299 条没有 occurrence token**。
这解释了「有值边却查不到」的 16 条，也解释了为什么 provider 必须 exact token：
多数边本来就没带可读的 occurrence。

## 头部 3 类样本

### 1. 该对无 VALUE_FLOW（184 条主因）

```text
branch     105388 读 pdata_n.t03_agt_rela_h ← 103935
           write-observation:103935:3
role       UNKNOWN（同表多写者 fan-out）
期望 id    create#2:root.a.read.t03_agt_rela_h
           root.a.read.t03_agt_rela_h
实际能拿到  这对 consumer|producer|表 的 VALUE_FLOW = 0
           无任何 consumer-read token 可对齐
```

这是 119044 / 105388 的 LEFT 维表。值通道本来就不该 CONFIRMED。
正确标签是 `FIELD_VALUE = NOT_APPLICABLE`，不是 OCCURRENCE 缺失。
基线里这些表「全通道 UNKNOWN、没进档一」与此一致；错的是 gap 名字让它看起来像
occurrence 事故。

### 2. VALUE_FLOW 无 occurrence token（16 条）

```text
branch     105387 自读 pdata_n.t03_agt_stati_info_h
           query#3:root.setop.b0.setop.b0.setop.b0.read.t03_agt_stati_info_h
期望 id    query#3:root.setop.…read.t03_agt_stati_info_h
           root.setop.…read.t03_agt_stati_info_h
实际能拿到  该对有 VALUE_FLOW，但 occurrence token 集合为空
           （441 条值边里 299 条都是这种：有边、无 consumer-read locator）
```

不是闭包把 id 拼错。是 field-lineage 边没把读 occurrence 写进
`field-lineage:consumer-read:<task>:<token>`。provider 遇到空 token 直接 `continue`，
lookup 再报 OCCURRENCE。局部补：空 token 时不要冒充 occurrence 缺失；有值边可按
(consumer, producer, 表) 回退，或把缺 locator 记成单独 gap。

### 3. token 即使用 relation 尾巴也对不上（13 条）

```text
branch     176827 读 pdata_n.t98_sb_tit_day_hold_indx ← 121575
期望 id    query#0:root.casttable.setop.b1.m.read.t98_sb_tit_day_hold_indx
           root.casttable.setop.b1.m.read.t98_sb_tit_day_hold_indx
实际能拿到  query#0:root.casttable.setop.b0.pecm.read.t98_sb_tit_day_hold_indx
           :root.casttable.setop.b0.pecm.read.t98_sb_tit_day_hold_indx
```

同物理表、两次不同读。闭包按 occurrence 对齐是对的，不能用表名糊过去。
这 13 条保持 UNKNOWN 或改成「该 occurrence 无值边」即可，不必改 occurrence 模型。

## 和档二仍空的关系

**1499 条 OCCURRENCE 不是 176827 档二为空的直接原因。**

105387 → 78473（`create#1:root.b.read.d_ref_trs`，PRIMARY）上：

- `demandedFieldNames` 已有 `Agt_Modifr1` / `KEY_OTC_TRADE_ID`（CASE 拉链已打上）
- `ROW_MEMBERSHIP` 终态仍是 UNKNOWN，gap 是
  `relation-summary-gap:105387:ROOT_RELATION_NOT_FOUND` 和 `NO_CLOSED_PATH`
- 不是 `OCCURRENCE_EVIDENCE_NOT_FOUND`

155015 档二能出四张 ref，是因为根任务 JOIN 把 `ROW_MEMBERSHIP` 传进了 105387。
176827 对 105387 只走了 `FIELD_VALUE`（`stati_cont_desc`）；根虽然 seed 了全部通道，
但 `emit()` 要求下游同通道已有状态，值跳不会自动带行通道。拉链 CASE 是局部 CONFIRMED，
传不到 176827 的档二。

这属于 RS-3（行通道如何穿过值跳 / 需求列闭包），不要塞进「重构 occurrence」。

## 建议的 RS-1b 范围（仍须评审后再改代码）

只做局部、可逐项核对下降的三类：

1. 无 VALUE_FLOW 的 PHYSICAL_PRODUCER：`FIELD_VALUE = NOT_APPLICABLE`，不要写
   `OCCURRENCE_EVIDENCE_NOT_FOUND`。预期 OCCURRENCE 计数从 1499 掉到百级。
2. 有 VALUE_FLOW 但无 consumer-read token：单独 gap，或按 (任务, 表) 回退，
   不要继续叫 OCCURRENCE。
3. `unknownReasonCounts` 按 assessment 去重，不要把 fan-out 兄弟 gap 加进计数。

**不要做：** 重构 occurrence 身份、用表名模糊匹配、为了消 1499 去改传播图。

档二要非空且不过宽，走 RS-3：沿值链穿过 119044，让 105387 上已有的 `Agt_Modifr`
行通道继续往上问；只 emit 本地通道，LEFT 维表不得进档二。155015 已证明规则本身成立。
