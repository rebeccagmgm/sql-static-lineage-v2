## Context

现有主链为 `parse → lower → resolveScopes → qualify → lineage → Plan Facts → Machine Facts → table/field reconciliation`。`src` 提供多方言 immutable IR、原始 token/expression/span 和 schema-aware 字段绑定；Plan Facts 已保存 read/project/filter/join/aggregate/expand/setop、predicate tree、window input role、scope 与物理来源；field-lineage 以精确物理字段和表级 primary producer bridge 递归，但控制依赖仍是 annotation，且所有根字段共享 traversal visited/budget。现有 field-lineage 与 renderer 同时被多条产品链路消费和修改，不适合作为新 assessment 产品的原地升级容器。

现有 change `input-pack-driven-field-lineage` 已完成，不能被本变更回写或改写历史要求。本变更在其 canonical artifact 和现有 pipeline 之上增量演进。当前仓库是 Node/TypeScript；Java 仅作为非默认测试工具可用。

## Goals / Non-Goals

**Goals:**

- 建立面向目标字段的统一静态依赖模型和保守证明流程。
- 在同一仓库中建立可独立执行、验证、发布和回滚的 causal-slice consumer，不改变旧 field-lineage 的输出契约。
- 让控制字段与 relation-level dependency 可跨 Task 递归，但不污染 VALUE_FLOW 主图。
- 对每个目标字段和已知候选分支给出完整、可验证、不可静默遗漏的 assessment。
- 让 Calcite 作为贯穿 Native 算子开发、回归和发布验收的并行语义校验轨，同时保留现有证据主链和默认部署方式。
- 允许 209119 只做 field-only 增量重算。

**Non-Goals:**

- 不重写或替换现有 parser、IR、scope、qualification、Machine Facts 和 producer-index。
- 不把旧 `FIELD_MULTI_HOP_RECONCILIATION` 1.1 artifact 原地升级为 causal assessment artifact。
- 不承诺纯静态 Precision/Recall 或真实运行因果关系。
- 不在首版把 Calcite 作为生产依赖或默认 artifact 生成器。
- 不从源码字符串、字段名相似度、Task 类型或运行假设猜测缺失身份和 scope。
- 不在本变更中接入运行实例参数、真实分区变化或数据内容验证。

## Decisions

### 0. Use an isolated consumer, artifact, CLI, and renderer

新能力位于 `scripts/reconcile/consumer/target-field-causal-slice/`，输出 `TARGET_FIELD_CAUSAL_SLICE` artifact，并由独立 CLI 和 renderer 生成：

```text
scripts/reconcile/consumer/target-field-causal-slice/
├─ target-field-causal-slice-contract.ts
├─ canonical-evidence-adapter.ts
├─ semantic-dependency-contract.ts
├─ operator-support-matrix.ts
├─ semantic-dependency-normalizer.ts
├─ causal-traversal.ts
├─ candidate-universe.ts
├─ causal-assessment.ts
├─ evidence-closure.ts
├─ format-target-field-causal-slice.ts
└─ reconcile-target-field-causal-slice.ts

scripts/visualize/target-field-causal-slice-visualize.ts
schemas/target-field-causal-slice.schema.json
tests/target-field-causal-slice/
```

文件名为 `target-field-causal-slice.json`、`target-field-causal-slice.txt` 和 `target-field-causal-slice.html`。旧 field-lineage 仅作为可选兼容/差分输入，不是新 assessment 的写入目标。替代方案是继续发布 field-lineage 1.2；该方案会让旧消费者、HTML 和并行功能承担新证明语义，故不采用。另起仓库会复制 TypeScript contract、fixture 和构建链，首版也不采用。

### 1. Canonical facts and semantic conclusions remain separate

`src`、Plan Facts 和 Machine Facts 继续回答“SQL/Schema/Task 中确定观察到了什么”；新增 semantic layer 回答“这些 operator facts 对指定 target criterion 可能产生什么影响”。Semantic layer 只引用 canonical fact/evidence ID，不写回原始 IR 或 Machine Facts。

替代方案是用 Calcite `SqlNode/RelNode` 替换当前 IR，或把当前 Plan Facts 全量转换为 `RelNode`。这会形成双 IR、丢失 source span/模板语义并重做方言适配，因此不采用。

### 2. SemanticDependency uses orthogonal dimensions

内部统一类型包括：

```text
subjectKind: PHYSICAL_FIELD | RELATION_OCCURRENCE
effectKind: VALUE_CONTRIBUTION | BRANCH_SELECTION | ROW_MEMBERSHIP |
            MULTIPLICITY | GROUPING | ORDERING | WINDOW_CONTEXT |
            SET_MEMBERSHIP | RELATION_EXISTENCE
operatorKind: PROJECT | FILTER | JOIN | AGGREGATE | DISTINCT | SETOP |
              WINDOW | TOP_N | SUBQUERY | RELATION
rootDependenceKind: VALUE_TO_TARGET | CONTROL_TO_TARGET | RELATION_TO_TARGET
localEdgeKind: VALUE_FLOW | EXPRESSION_CONTROL | ROWSET_CONTROL |
               WINDOW_CONTEXT | RELATION_CONTEXT
```

局部边保留真实 operator 语义；path 使用 `rootDependenceKind` 解释该分支最终为什么影响 root target。普通 window value input 是 VALUE_FLOW，partition/order/frame 是 WINDOW_CONTEXT；ORDER BY 只有和 LIMIT/TOP/FETCH 共同作用时才成为 ROWSET_CONTROL。

### 3. Dependency normalization precedes traversal

先从 Plan Facts 生成稳定、可去重的 dependency definitions，再为每个 root criterion 生成 applications 和 edges。Operator support matrix 明确每个 relation/expression role 的支持级别和 proof obligation。

- CASE/IF：条件为 BRANCH_SELECTION，结果分支为 VALUE_CONTRIBUTION。
- COALESCE：参数提供候选值并参与分支选择，两种作用分别建边。
- JOIN：condition field 提供结构依赖；join type 决定 row membership/multiplicity 方向；unique key 只细化 fanout。
- GROUP BY/DISTINCT/SETOP：分别表达 grouping、dedup 和 set membership。
- COUNT(*)、literal-from-relation、EXISTS、CROSS JOIN：使用 relation occurrence subject。
- 未覆盖 operator 创建 support gap，成为 negative proof 的硬阻断条件。

### 4. VALUE and CONTROL share one physical resolver and expander

抽取公共 physical field resolver：qualified identity → Task default schema qualification → unique Table Pack/catalog leaf match → task-local schema-backed identity。VALUE 与控制依赖必须调用同一入口。

抽取公共 physical field expander：加载 producer bridge、read occurrence、producer write、Input Pack/Machine Facts、next output binding 和 evidence refs。调用方只传 root criterion、root/local dependence kind、path certainty、field/relation state 与 candidate branch；不得复制 producer selection 算法。

跨 Task edge 必须引用 candidateBranchId、read occurrence evidence、consumer physical input、producer write 和 producer output binding。无法形成连续 refs 时停止为 gap。

### 5. Each root target field owns independent traversal state

每个 target field 独立执行 slicing；definitions、physical nodes 和 evidence objects 通过 canonical ID 共享，visited/cycle/frontier/path certainty/assessment 不共享。状态 key 至少包含 rootTargetField、taskId、subject、binding/relation occurrence、rootDependenceKind 和 localEdgeKind。

VALUE 与 CONTROL 使用独立 `maxValueStates/maxValuePaths` 和 `maxControlStates/maxControlPaths`，共享 `maxDepth`。CONTROL budget 截断只影响控制 completeness；任何截断都会阻止受影响分支产生 negative proof。

### 6. Candidate Universe is projected, not rediscovered

Candidate Universe 读取当前 fingerprint 对应的 table multi-hop artifact：

- ROOT_WRITE
- PHYSICAL_PRODUCER（consumer + producer + physical table + read occurrence）
- SCHEDULE_ONLY
- UNBOUND_READ
- BLOCKED_READ / UNIVERSE_BOUNDARY

`producerRole` 不进入 branch ID，以保证 additional/primary 等证据判断变化时 ID 稳定。Field slicer 不重新运行 producer selection，也不创建 table artifact 未枚举的上游实体。

### 7. Positive path propagation and final assessment are separate

Traversal 只传播 PathCertainty：CONFIRMED、CONDITIONAL、UNKNOWN。Evidence closure 读取完整 candidate pair universe 后生成最终 CausalAssessment。

- 完整 confirmed positive path → CONFIRMED_RELATED。
- positive path 包含 provisional/runtime condition → CONDITIONAL_RELATED。
- 必要 identity/scope/operator/budget 缺失 → UNKNOWN + gap。
- 完整负向搜索、无 positive dependency、无 gap/limit/unmodeled operator、具备 negative proof → PROVEN_UNRELATED。

PROVEN_UNRELATED cut 只可传播给 Candidate Universe 中已经枚举且可证明位于 cut 后的分支，proof reason 为 `INHERITED_FROM_PROVEN_UNRELATED_CUT`。

### 8. Independent artifact preserves old field-lineage readers by separation

新 `TARGET_FIELD_CAUSAL_SLICE` artifact 使用自己的 schema/version/content hash，并引用而非覆盖旧 VALUE_FLOW evidence。Artifact 包含 definitions/applications/control edges、candidate universe、assessments、proofs、separate limits、metrics 和 rerun sets。Validator 强制：

- 每个 rootField×candidateBranch 恰好一个 assessment。
- UNKNOWN 至少一个 gap ref。
- CONFIRMED_RELATED proof path 证据连续。
- PROVEN_UNRELATED negative proof obligations 完整。
- confirmed 数量大于零时 closure rate 为 1.0；否则 NOT_APPLICABLE。
- Precision/Recall 固定 NOT_EVALUATED。

旧 field-lineage artifact reader/renderer 不改。新 consumer 可读取匹配 fingerprint 的旧 artifact 作为对照或 VALUE evidence shortcut，但必须回到 canonical evidence refs 验证，不能把旧 artifact absence 当成阻断，也不能伪造 assessment。

### 9. The new renderer is a pure causal-slice artifact consumer

新文本和 HTML 只读取 causal-slice artifact：展示逐目标字段最小确定集、保守安全集、candidate branch 分类、proof/gap、value/control limits 和 operator support。Renderer 不重新构图或推断 Task 是否相关。旧 field-lineage renderer 保持原样；需要展示 legacy VALUE_FLOW 时，新 artifact 保存显式引用/投影。

### 10. Calcite is a continuous differential oracle with explicit shadow mode

在独立工具目录固定 Calcite 1.42.0，提供 JSONL stdin/stdout 协议。输入包含标准化 schema、SQL/dialect hint 和 requested metadata；输出 observation、operator/table/column mapping、unsupported/failed reason 和 Calcite/version fingerprints。

Calcite 不再等到实现末尾才运行。CASE/IF/COALESCE、filter/join、aggregate/setop、window/Top-N、relation-context 每批 Native transfer rule 都必须同步维护差分 fixture，并在该批完成前运行独立 Calcite 命令。Differential reconciler 输出 `NATIVE_CONFIRMED`、`CALCITE_CORROBORATED`、`CALCITE_ONLY_UNMAPPABLE`、`NOT_EVALUATED` 和 `SEMANTIC_ENGINE_CONFLICT`，保留双方 observation、mapping refs 与版本 fingerprint。

首版同时提供显式 `--semantic-oracle calcite` shadow 模式：仅在调用方主动启用且 Java 工具可用时运行，生成独立 differential report，并可在 causal-slice artifact 中写入不参与 content decision 的 validation summary。默认 `npm test`、causal-slice CLI 和 pipeline 不构建或启动 Java。Calcite observation 不直接生成 dependency/assessment；双方冲突必须通过 reconciler 转为 `SEMANTIC_ENGINE_CONFLICT` gap 并将相关 assessment 降为 `UNKNOWN`。

Calcite differential 是每个 operator batch 的完成条件，但 Calcite unsupported/failure 不是 Native 结论的自动降级条件：已有 canonical proof 保持不变，报告记录 `NOT_EVALUATED`。只有双方针对同一已精确映射语义对象发生实质冲突时才降级。稳定且可映射的 Calcite 额外结论先沉淀为 Native regression fixture 和规则。

生产决策侧车仍是后续独立 change。准入条件为：真实 Horae/Hive/Spark 语料的解析和 occurrence mapping 稳定、所有冲突可检测且 fail closed、209119 等真实任务证明能增加可映射 observation 或减少有意义的 Unknown 且不破坏 confirmed evidence closure、性能和 Java 运维成本可接受。

### 11. 209119 uses causal-slice-only replay

独立 CLI 在现有 Input Pack fingerprint、Machine Facts、producer index 和 table artifact 一致时跳过采集、旧 field-lineage 重建与全量 producer-index 构建，只重算 semantic dependencies、causal slice、独立 artifact、summary 和 HTML。fingerprint 不一致时 fail closed，并明确要求重建哪一层输入。

### 12. Shared evidence adapters and causal proof stages remain separate

现有 physical resolver/expander 先硬化为共享 evidence adapter，并通过兼容 re-export 保持旧 field-lineage 行为。semantic contract/support matrix/normalizer 迁入独立 causal-slice 模块。新模块按 causal traversal、candidate universe、assessment/evidence closure 和 orchestration 拆分；旧 CLI/renderer 不直接访问新 traversal state，新 CLI/renderer 也不写回旧 artifact。

## Risks / Trade-offs

- [Operator semantics scope expands quickly] → 先冻结 support matrix；任何未覆盖 cell 产生 Unknown，不用启发式补齐。
- [Control traversal causes graph explosion] → VALUE/CONTROL 独立预算、稳定状态 key、definition 去重和 per-root slicing。
- [Candidate Universe inherits incomplete table evidence] → 显式 coverage boundary；禁止生成 PROVEN_UNRELATED。
- [Physical resolver refactor changes existing VALUE paths] → 先用当前 field-lineage fixtures 锁定 VALUE_FLOW，再让 control 共用同一 resolver。
- [独立 artifact 与旧 artifact 产生语义漂移] → 使用 fingerprint、canonical evidence refs 和差分测试显式绑定；任何不一致保留 Unknown。
- [共享 resolver/expander 修改导致旧 VALUE 回归] → 兼容 re-export、冻结旧 field-lineage golden，并在新模块启用前完成 occurrence/read/write 证据校验。
- [Calcite dialect differs from Horae Hive/Spark] → 差分结果带 NOT_EVALUATED/UNSUPPORTED；shadow 模式不进入 confirmed proof，冲突 fail closed。
- [Calcite metadata still lacks base table constraints] → Unknown 保留；不把 metadata absence 当 negative proof。
- [209119 artifacts are stale or browser-locked] → 校验 fingerprint 后写 staging，并使用现有可恢复发布流程；不在 field-only 过程中重命名未确认的目录。

## Migration Plan

1. 冻结旧 field-lineage golden，并修复共享 Plan Facts/resolver/expander 的证据缺口，不改变旧 artifact 输出。
2. 建立独立 causal-slice 目录、contract、schema 和 canonical evidence adapter；迁入 semantic contract/support matrix/normalizer，并把 Calcite mapping contract 接入同一 operator matrix。
3. 按 expression、rowset、aggregate/setop、window/Top-N、relation-context 批次完成 Native transfer rules；每批同步完成 Calcite fixture、mapping 和 differential gate。
4. 完成 shared expander 的 occurrence-specific 证据校验，并启用 per-root value/control traversal。
5. 建立 Candidate Universe、positive assessment 和 `negativeProofMode=SAFE_RULES_ONLY`；未满足负向证明义务的 pair 保持 Unknown。
6. 发布独立 causal-slice artifact、CLI、summary/HTML、rerun sets，以及显式 Calcite shadow report/validation summary。
7. 使用已固定 fingerprint 的 209119 做 causal-slice-only 验收并生成独立 JSON/摘要/HTML，同时验证旧 artifact 未变化，并用 shadow A/B 形成生产侧车 go/no-go 证据。

回滚时关闭独立 causal-slice CLI/发布入口并删除其产物；旧 field-lineage、Input Pack、Machine Facts、producer index 和 table artifact 不迁移、不重写。Calcite 工具独立，可直接从差分测试流程移除。
