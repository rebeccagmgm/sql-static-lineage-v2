## 1. Baseline and target-write identity

- [x] 1.1 冻结旧 `FIELD_MULTI_HOP_RECONCILIATION`、field-lineage 和 target-field-causal-slice 的 golden/hash 回归样本，确认本 change 的独立 artifact type、文件名和 schema version。
- [x] 1.2 定义 `TargetWriteIdentity`（包含 `sqlSourceId`、statement ordinal、write ordinal）与 `AnalysisSnapshotRef`，将稳定写入身份和输入 fingerprint/hash 分开保存。
- [x] 1.3 实现 `TargetWriteResolver`：把 task、目标物理表、SQL source/slot、statement/write ordinal、root relation 和 canonical write evidence 唯一绑定。
- [x] 1.4 覆盖多候选写入、root relation 无法映射和 write evidence 缺失，分别输出 `TARGET_WRITE_AMBIGUOUS`、`TARGET_WRITE_RELATION_UNMAPPED` 或对应 gap，不猜测根。
- [x] 1.5 为目标表闭包 CLI 增加 causal-only、输入 fingerprint、时间/内存/图规模/深度预算和结构化 fail-fast 输出。
- [x] 1.6 从现有 table multi-hop artifact 投影最小 Candidate Universe：ROOT_WRITE、PHYSICAL_PRODUCER、SCHEDULE_ONLY、UNBOUND_READ、BLOCKED_READ、COVERAGE_BOUNDARY。

## 2. M1: Single-task value closure

- [x] 2.1 建立目标表级 artifact contract，主 assessment key 使用 `targetWriteId + candidateBranchId`，不包含 root target field。
- [x] 2.2 建立 `FieldValueEvidenceProvider` 或 canonical VALUE_FLOW index 的候选分支聚合接口，返回 channel status、output field bindings、affected target fields、evidence refs 和 gap refs，并验证现有字段证据只扫描/加载一次。
- [ ] 2.3 以 provider adapter 实现 project/value、CASE/IF/COALESCE 的单 Task `FIELD_VALUE` 聚合；只有 provider 无法精确接续时才启用完整 Task-local field port。
- [x] 2.4 实现单 Task 目标写入闭包和最小 artifact contract；确认字段数量增加不会生成字段×候选分支 assessment。
- [x] 2.5 覆盖 field-lineage 缺失：仅将 `FIELD_VALUE` 标为 `UNKNOWN`，不阻断其他通道，也不生成 `PROVEN_UNRELATED`。

## 3. M2: Cross-task field bridge

- [x] 3.1 复用 exact producer/read bridge、relation bridge 和 occurrence-specific evidence refs，输出 resolved/ambiguous/missing bridge 统计，并识别 `PRODUCER_WRITE_AMBIGUOUS`。
- [ ] 3.2 先实现跨 Task provider 聚合的 `FIELD_VALUE` 接续，覆盖同表多次读取、self join 和多个 write observation 隔离；仅在 Gate A 证明 provider 不足时实现完整 field-port propagation。
- [x] 3.3 验证 Task-local semantic edge 不携带 `candidateBranchId`，只有跨任务 bridge edge 携带候选分支身份。
- [x] 3.4 验证同一输入只影响部分输出字段时不会无差别传播到 Task 的全部字段。

> **2026-09-01 实测校准。** 3.4 生效：176827 档一里 119044 只挂
> `book_bel_dept, cutp_pty_shor_name, end_prcg_date, erly_trmt_date, inr_ord_id` 五列，
> 未广播到全部字段。第六列 `Book_Agt_Id` 不是输出列，是去 LEFT JOIN 持仓
> PEPV 的键。LEFT 可空侧按 5.1 **不是** `ROW_MEMBERSHIP`，最多 `MULTIPLICITY`。
> **不要**把 `t03_agt_rela_h` 写成档二完成标准（会和刚钉住的侧别打架）。
> 档二要召回的是 105387 拉链四张 ref（176827 上是 163064 / 179886 / 78473）。

## 4. Gate A: 209119 structural and performance gate

- [x] 4.1 验证 `TargetWriteIdentity` 唯一构造、Candidate Universe 投影成功、assessment 数量不超过唯一 candidate branch 数且不存在 137×549。
- [x] 4.2 验证字段证据只扫描/加载一次、跨任务 bridge closure 统计可见、阶段耗时/调用数/cache hit/miss/峰值内存可见。
- [x] 4.3 验收缓存复用模式约 5 分钟内、峰值内存约 1GB 内；不通过则停止后续 operator 扩展并先修粒度/缓存。

## 5. M3: Row membership and task rollup

- [x] 5.1 实现 WHERE/HAVING/QUALIFY、INNER/OUTER/SEMI/ANTI/CROSS JOIN 的 `ROW_MEMBERSHIP`/`MULTIPLICITY` 规则；JOIN dependency 不以 uniqueness 为前提。
- [x] 5.2 建立去重 GlobalImpactGraph，local semantic edge 与 producer bridge edge 分层保存。
- [x] 5.3 实现从 TargetWriteRef 出发的一次有界反向闭包和 task-level rollup，保留 channel、certainty、evidence/gap refs；`ROOT_WRITE` 不计入上游任务数量。
- [x] 5.4 覆盖一个 Task 多个 branch、多通道和 task rollup 状态，验证任务级最小确定集与保守安全集。

> **2026-09-01 代码核对（见 `176827-baseline-evidence.md` 与 `docs/execution-plan-rerun-shrink.md`）。**
> 5.1 的侧别规则已经实现且方向正确：LEFT 保留侧
> `[ROW_MEMBERSHIP, RELATION_EXISTENCE]`、可空侧 `[MULTIPLICITY, RELATION_EXISTENCE]`。
> `join-side-and-field-scope.test.ts` 已按这个断言。拉链 CASE 在 summary 层
> 由 `existenceCaseSelections()` 接到 `EXPRESSION_CONTROL` + `ROW_MEMBERSHIP`，
> 夹具已绿。**不要再改 `joinSideChannels()`。**
>
> `176827-baseline.json`（13:07）里 RM CONFIRMED 仍为 0，是因为值链上 119044
> 这一跳没把行通道问进去。13:51 播种把拉链三张和 LEFT 维表都送进了档二。
> 14:17 收口：值召回任务用本地 `EXPRESSION_CONTROL` 问 RM，挂在 `FIELD_VALUE`
> 上，不再把父节点 RM 广播给 LEFT 可空维表。LEFT 维表现在在档三。
> 14:22 再收：generic CASE 不再给子孙 read 打 `EXPRESSION_CONTROL`，档二仅拉链三张。
> **不要**改 `joinSideChannels()`。这不是 5.1。

## 6. M4: Relation-level dependencies and channel algebra

- [x] 6.1 实现 COUNT(*)、EXISTS、literal-from-relation 和 CROSS JOIN 的 `RELATION_EXISTENCE`/基数影响。
- [x] 6.2 定义 `ChannelAssessment`：`CONFIRMED`、`CONDITIONAL`、`PROVEN_ABSENT`、`UNKNOWN`、`NOT_APPLICABLE`，分别保存 proof/witness/gap refs。
- [x] 6.3 实现路径内 certainty 串联、同 channel 备选路径合并和不同 channel 的 relationStatus 聚合，验证 `FIELD_VALUE=CONFIRMED` 不被独立 `MULTIPLICITY=UNKNOWN` 降级；覆盖 target-rooted multi-hop、同 channel 备选路径和上游 Unknown 继承。
- [x] 6.4 预留 negative proof safe rules（本轮重新关闭）：不生成 `PROVEN_ABSENT`/`PROVEN_UNRELATED`，validator 对 negative proof fail-closed；未来显式 gate 再实现并验收。
- [x] 6.5 验证未建模 operator、coverage boundary、截断和未知 identity 都只能产生 Unknown/gap。
- [ ] 6.6 验证 Calcite/native 语义冲突只降级对应 channel；目标写入、read occurrence 或 producer bridge identity 冲突才阻断整个候选分支。

## 7. Gate B: 209119 product-value gate

- [x] 7.1 核对 FIELD_VALUE、FILTER、INNER/LEFT JOIN、COUNT(*)、EXISTS、CROSS JOIN、MULTIPLICITY 和 task rollup。
- [x] 7.2 评估候选范围是否比纯表血缘合理、Unknown 是否可定位、bridge closure 是否值得继续投入；未通过则停止 M5/M6。

> Gate B evaluation is complete. The Phase 4 projection-readiness prerequisite passes with scope, but the evidence still does not establish a runtime rerun list or justify M5/M6 expansion. M5/M6 remain paused.

## 7b. P0 重跑收缩（176827 / 155015）

执行方案：`docs/execution-plan-rerun-shrink.md`。
播种前冻结：`176827-baseline.json`（13:07，档二空、UNKNOWN 32、OCCURRENCE 1499）。
对照产物不要混：`155015.json`（14:22）档二仍是四张 ref，是规则正例；
`176827.json`（14:22）档二仅拉链三张，LEFT / 103943 generic CASE 子查询在档三。
13:51 的 16 条过宽、14:17 的 8 条中间态已被覆盖，不当金样。

209119 的 Gate A/B 只证明骨架能跑。播种前 176827 的产品缺口是档二空、32/59 UNKNOWN。
`unknownReasonCounts` 合计 2443 是 gap 字符串次数：OCCURRENCE 1499 不是 1499 次故障
（见 `176827-rs1a-occurrence-diagnosis.md`：真正带该 gap 的 PHYSICAL_PRODUCER 是 222 条，
其中 184 条根本没有 VALUE_FLOW）。

- [ ] 7b.1 RS-0 基线固化：封装 176827 / 155015 复现命令；单条 canonical write 时自动推断 `--write-observation-id`；对比脚本去掉 `generatedAt` / `stages` 后比档位与 `unknownReasonCounts`。证据文件承认 155015 档二已有四张 ref；旧「档二 empty」作废。`176827-baseline.json` 档一 27 个 taskId 是金样；14:17 / 14:22 的 `176827.json` 不当播种前基线。
- [ ] 7b.2 RS-0.5 按列过滤档一：可选 `--target-field`，纯输出层过滤，不传时档位 + 档一 taskId 集合与基线一致。**不算主线交付**——整表场景不过滤，收缩为零。
- [x] 7b.3 RS-1a **待评审的已完成**。诊断在 `176827-rs1a-occurrence-diagnosis.md`。不要再做一遍 `sameOccurrence` vs `occurrenceTokenMatches`。采信默认：1499 不是档二原因；83% 是无 VALUE_FLOW 被错标成 OCCURRENCE。推翻须写明为什么那张表是错的。
- [x] 7b.4 RS-1b 可选，不影响档二。范围仅诊断三条：（1）无 VALUE_FLOW → `FIELD_VALUE=NOT_APPLICABLE`；（2）有边无 consumer-read token → 单独 gap 或按 (任务, 表) 回退；（3）`unknownReasonCounts` 按 assessment 去重。不改匹配函数、不重构 occurrence。
- [x] 7b.5 RS-2 只在 summary / rollup / `shrinkReport` 按 `(task, table)` 合并；`assessments` 数量与键不变。
- [x] 7b.6 RS-3 **已收口**。值召回跳：本地有拉链 CASE（`EXPRESSION_CONTROL` 不是 N/A）才问 RM；问的时候挂在 `FIELD_VALUE` 上，不继承父节点 RM。generic CASE 不再给子孙 read 打 `EXPRESSION_CONTROL`（103943 LEFT 子查询不再开闸）。不改 `joinSideChannels()`，不接 `BRANCH_SELECTOR`，不勾 2.3。176827 档二仅 163064 / 179886 / 78473 via Agt_Modifr1；LEFT 维表进档三。
- [x] 7b.7 RS-4 档四 198 条换成稳定原因码（无 bridge / 覆盖边界 / SCHEDULE_ONLY / UNBOUND_READ / 未建模算子）；文案只能是「本轮证不出」，禁止「无关」。档三按 `(任务, JOIN 节点)` 带 witness，summary 默认折叠。
- [x] 7b.8 RS-5 跑 176827 + 155015 验收：档一 27 个任务不丢；176827 档二含 163064 / 179886 / 78473 且不含 LEFT 维表；155015 档二四张 ref 不得变空（回归，不是新能力）；档四有原因码；未触达现有 1GiB / 300s 预算。UNKNOWN 下降仅当 7b.4 已合入时考核。**2026-09-01 22:22：** 档一 27 unique taskId 与基线一致；档二仅拉链三张；LEFT / 103943 generic-CASE 子查询不在档二；155015 四张 ref 经 Agt_Modifr1；档四有原因码；peak ~552MB。
- [ ] 7b.9 RS-6 条件启动：7b.4 之后（或决定不开 7b.4 时单独评审）按剩余 UNKNOWN 分布决定是否消费 `SRC_TBL` 分区谓词。

## 8. M5: Remaining operator semantics and bounded propagation (Gate B 通过后)

- [ ] 8.1 实现 AGGREGATE、GROUP BY、DISTINCT、UNION/INTERSECT/EXCEPT 的 GROUPING/SET_MEMBERSHIP 规则。
- [ ] 8.2 实现 WINDOW value/partition/order/frame，以及 ORDER + LIMIT/TOP/FETCH 的 WINDOW_EFFECT/ORDER_SELECTION 规则。
- [ ] 8.3 完成 PathCertainty、循环/重复状态检测、少量 witness predecessor 回溯，以及 VALUE/CONTROL/RELATION 独立预算。
- [ ] 8.4 验证一次 global propagation 不保存完整路径集合，不按字段或候选分支重复执行 semantic summary。

## 9. M6: Calcite shadow and differential reuse (Gate B 通过后)

- [ ] 9.1 将现有 Calcite Rel bridge/differential adapter 接入 semantic digest 级缓存，验证调用次数以上限唯一 digest 数量为准。
- [ ] 9.2 为 JOIN、FILTER、AGGREGATE、SETOP、WINDOW、Top-N 和 relation-context 增加 mapped/unsupported/unmappable/conflict fixture。
- [ ] 9.3 验证 Calcite corroboration 只写 validation observation；unsupported/unavailable 记录 `NOT_EVALUATED`，冲突生成 `SEMANTIC_ENGINE_CONFLICT` 并按通道或共享 identity 规则降级。
- [ ] 9.4 在 Java/Calcite 不可用时验证默认 TypeScript causal-only 命令、默认测试和旧 field-lineage 命令仍可运行。

## 10. M7: Artifact, renderer, and 209119 acceptance (M5/M6 通过后)

- [ ] 10.1 发布独立目标表闭包 JSON schema、canonical artifact、summary 和 HTML；包含 TargetWriteIdentity、AnalysisSnapshotRef、逐通道 assessment、task rollup、proof/gap 和 `runtimeRerunDecision = NOT_EVALUATED`。
- [ ] 10.2 验证 renderer 只读取 canonical artifact，不重新计算结论；旧 field-lineage artifact/HTML/hash 和 CLI 行为保持不变。
- [ ] 10.3 输出 load、summary、Calcite、candidate projection、graph、propagation、validation、render 各阶段耗时、调用数、cache hit/miss、节点/边数和峰值内存。
- [ ] 10.4 校验 209119 Input Pack、Plan/Machine Facts、producer index 和 table artifact fingerprint；一致时禁止全量采集、旧 field-lineage 重建和全量 producer-index 重建。
- [ ] 10.5 运行 209119 causal-only 正式验收：主 assessment 按唯一 candidate branch 计，不存在 137×549 字段矩阵；核对 FIELD_VALUE、ROW_MEMBERSHIP、MULTIPLICITY、RELATION_EXISTENCE 和 task rollup。
- [ ] 10.6 输出最终性能报告；复用输入模式约 5 分钟内、峰值内存约 1GB 内，超出时先定位阶段，不通过提高 heap 或延长等待掩盖。

## 11. Documentation and handoff

- [x] 11.1 更新使用说明，明确静态 relationStatus、逐通道 ChannelAssessment、最小确定集、保守安全集和 runtimeRerunDecision 的边界。
- [ ] 11.2 记录 operator support matrix、Calcite differential 状态、Known Unknown、bridge closure 和性能基准结果。
- [ ] 11.3 完成 targeted tests、typecheck、build/format/inspect 以及默认无 Java 的回归验证。
- [ ] 11.4 形成 review checklist：目标写入身份可构造、字段只作内部 field port、无字段笛卡尔积、无静默裁枝、无 Calcite 强依赖、所有 Unknown 可追溯。
