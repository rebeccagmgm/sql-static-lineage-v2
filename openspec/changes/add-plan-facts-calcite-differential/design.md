## Context

见 `proposal.md`。当前仓库已经有两个可复用但边界不同的组件：

- `src → scripts/plans/plan-adapter.ts → PlanFacts` 负责方言、作用域、物理身份、source span 和结构化算子事实。
- `scripts/calcite-oracle/` 与 `tools/calcite-oracle/` 负责 raw SQL JSONL 请求、Calcite 1.42.0 metadata 和纯差分，但真实 Horae/Hive SQL 仍可能在 Calcite parser/validator 前失败。

既有 `target-field-static-causal-slice` change 已完成并明确 Calcite不是 canonical 来源。本变更不改写该历史设计，而是新增一条 Plan Facts 驱动的 Calcite输入路径，并把容易误导的 oracle命名迁移为 differential。

## Goals / Non-Goals

**Goals:**

- 复用 Plan Facts 作为 Native与 Calcite之间的稳定方言防火墙。
- 让 Calcite在不解析原始 Horae/Hive SQL 的情况下执行关系 metadata 查询。
- 保留 relation occurrence、field/output ordinal、source evidence 到 Calcite observation 的连续映射。
- 默认关闭、失败隔离、独立产物、独立 Java验证命令。
- 通过旧链路 golden和命令级回归证明未启用 Calcite时行为不变。

**Non-Goals:**

- 不让 Calcite替换 `src` parser、scope、qualification、Plan Facts 或 Machine Facts。
- 不把 Calcite结果直接升级为 canonical dependency、causal assessment 或 negative proof。
- 不在首版覆盖所有 Hive UDF、lateral/UDTF、动态 SQL、相关子查询和 vendor type。
- 不在首版引入 Calcite optimizer rewrite；首版只构造未优化 logical tree并查询 metadata。
- 不在首版把 Java加入默认 npm安装、测试、pipeline 或发布依赖。

## Decisions

### 1. Add a versioned relational projection between Plan Facts and Java

TypeScript侧新增 `PlanFactsRelRequest` 投影器，而不是让 Java直接绑定完整 Plan Facts contract。投影只包含构造 Calcite logical tree所需的数据：

```text
request/version/fingerprint
schema + SQL types + nullability
relation nodes + stable native relation ids
typed expression/predicate trees
output ordinals and field identities
source/evidence references
requested metadata and hard limits
```

这样 Plan Facts可以继续演进，Java协议只在关系语义变化时升级。投影器遇到缺失类型、未知 expression role 或 unsupported relation时显式产生 projection issue，不把 expression text重新交给 Calcite parser。

替代方案是 Java直接读取 Plan Facts；这会让 Java与 TypeScript的大型内部 contract 强耦合。另一方案是把 Plan Facts重新打印成 SQL；这会重新引入方言、别名和 source identity问题，均不采用。

### 2. Build unoptimized Calcite logical nodes directly

Java侧使用固定 Calcite 1.42.0，通过 `RelBuilder`/logical relational nodes 构造：

```text
READ       → LogicalTableScan
PROJECT    → LogicalProject
FILTER     → LogicalFilter
JOIN       → LogicalJoin
AGGREGATE  → LogicalAggregate
SETOP      → LogicalUnion / LogicalIntersect / LogicalMinus
WINDOW     → RexOver within project/window-compatible nodes
TOP_N      → LogicalSort with offset/fetch
```

表达式投影转换为 typed `RexNode`。首版不执行优化规则，降低 node重写导致 occurrence映射丢失的风险。每个 logical node在旁路 mapping table中关联 Native relation id、input/output ordinal和evidence refs。

替代方案是继续以 raw SQL为主要输入；它保留为兼容/诊断 lane，但不能作为 Plan Facts differential的主路径。

### 3. Fail closed on types and functions

Calcite关系计划构造依赖类型系统。TypeScript投影器从已有 schema/Input Pack facts取得规范化类型和 nullable；Java维护有界的 type mapping和 operator/function registry。未知类型、无法确定的 cast、未注册 Hive UDF或参数类型冲突均返回结构化 unsupported issue。

不得把所有未知类型降为 `ANY` 后仍输出确定 metadata，因为这可能改变 overload、cast、comparison和nullability语义。`ANY` 只允许用于明确不影响所请求 metadata的受控 fixture，生产语料默认 fail closed。

### 4. Keep occurrence mapping outside Calcite identity

稳定 identity仍来自 Native：`task/statement/scope/relation occurrence/field or output ordinal`。Calcite node id仅是一次 differential运行内的定位信息，不进入 canonical id或稳定 artifact hash。

输出 observation必须携带回 Native identity的 mapping。若一个 Calcite observation因 projection、setop alignment或表达式转换无法唯一映射，状态为 `CALCITE_ONLY_UNMAPPABLE`，不能参与 agreement/conflict判断。

### 5. Separate raw-SQL and Plan-Facts request kinds

新 JSONL协议引入显式输入类型：

```text
RAW_SQL_V1       # 旧兼容/诊断 lane
PLAN_FACTS_REL_V1 # 新主 lane
```

响应统一包含 status、issues、metadata observations、mapping refs、protocol/Calcite/build fingerprint。raw SQL lane继续保留旧行为；新文档和命令默认展示 Plan Facts lane。

### 6. Rename by compatibility wrappers, not destructive moves

新 canonical目录：

```text
E:\02_area\股衍数据-数据cookbook\scripts\Calcite\
├─ protocol.ts / plan-facts-rel-contract.ts
├─ native-input/ / candidate-evidence/
└─ *test.mjs / test-runtime.ps1
```

旧 `scripts/calcite-oracle/` 导出 deprecated type/function aliases，旧 Java入口或 PowerShell命令在兼容期转发到新工具并输出迁移提示。协议中现有字段在 version 1兼容范围内保留；新 Plan Facts输入使用新协议版本。完成仓库内调用迁移和至少一个发布周期后，才可另开变更删除兼容入口。

### 7. Differential results never mutate canonical results

TypeScript reconciler保持纯函数，输入 Native observations和 Calcite response，输出独立 differential report。状态规范为：

```text
NATIVE_CONFIRMED
CALCITE_CORROBORATED
NATIVE_ONLY
CALCITE_ONLY_UNMAPPABLE
NOT_EVALUATED
SEMANTIC_ENGINE_CONFLICT
```

Calcite unsupported/failure不降低已有 Native canonical结论；同一精确映射对象上的实质冲突只在显式验证路径中暴露。任何 Calcite单方 observation都不能生成 `PROVEN_UNRELATED`。

### 8. Preserve default command and dependency graph

默认 pipeline不 import 新 differential runner，不探测 Java，不构建 jar。Java集成测试通过独立 npm/PowerShell命令运行；TypeScript协议、投影和 reconciliation单元测试仍可在没有 Java时运行。

建立两个回归层：

1. API/CLI gate：现有默认命令参数、退出码和产物集合不变。
2. Artifact gate：冻结代表性 field-lineage/causal-slice fixtures，Calcite关闭时 canonical内容契约等价。

### 9. Prove value on the core batch before expanding operators

实施顺序不是一次性覆盖全部 SQL，而是在最小可用关系子集后立即执行真实价值门禁：

1. protocol、rename compatibility、scan/project/filter。
2. join和aggregate，以及独立 differential runner。
3. 立即对209119运行 staging差分，形成 go/no-go 结论。
4. 只有 go 才继续 setop、window、Top-N。
5. subquery/lateral/Hive函数只按已量化的高频 Unknown继续扩展。

每批必须同时具备 TypeScript projection test、Java RelNode/runtime test、round-trip mapping test和 unsupported test。一个批次未通过时，不扩大 operator matrix。

价值门禁至少要求：默认链路无回归；所有被比较的 observation 均精确映射；Plan Facts lane 相比 raw SQL lane 增加实际可评价的 Calcite metadata；新增 metadata 能减少或解释 Native 的有意义 Unknown，而不是只重复 Native 已有事实；性能和 Java运维成本可接受。未通过时暂停后续算子扩展，并更新 OpenSpec范围，不以降低证据标准换取通过。

### 10. Evaluate 209119 without changing its canonical artifacts

209119验收复用已有 Input Pack、Plan Facts/Machine Facts和 table/causal artifacts，只生成 staging中的 differential report。首轮报告至少给出：

- 可投影/unsupported relation与expression数量。
- metadata observation及精确映射率。
- raw SQL lane与 Plan Facts lane的成功率差异。
- conflicts、unmappable和not-evaluated清单。

验收过程中不得覆盖 `artifacts/tasks/209119/` 下现有 canonical JSON/HTML。只有当 Plan Facts lane显著增加可映射 observation且无 canonical回归时，才讨论生产可选侧车。

## Risks / Trade-offs

- [Plan Facts expression facts不足以构建完整 RexNode] → 投影器逐项声明缺口；必要增强应另行修改 Plan Facts contract，不能回退到字符串猜测。
- [Schema只有字段身份没有精确类型] → 先建立类型覆盖报告；缺失类型保持 unsupported，不使用宽泛 ANY伪装成功。
- [Calcite logical node与 Native occurrence映射在复杂 setop/window中漂移] → 首版不优化，保留逐节点 mapping table，并把不可唯一映射结果隔离。
- [重命名破坏现有测试和脚本] → 先新增 canonical differential路径，再以 wrapper/alias迁移仓库内引用；禁止直接删除旧入口。
- [Java模块增加维护成本] → 固定版本、单模块、JSONL进程边界，默认 Node流程不加载。
- [差分报告大量 NOT_EVALUATED] → 先报告覆盖率，不降低 Native；按真实语料高频缺口扩展类型和算子，不以放宽证明标准改善数字。
- [Luna一次改动过大导致回归难定位] → 按任务批次提交，每批限定写入范围并由主代理复核后再进入下一批。

## Migration Plan

1. 冻结当前 default pipeline和代表性 canonical artifact回归基线。
2. 新增 differential协议、Plan Facts relation projection和旧 oracle兼容 aliases，不改默认入口。
3. 新建独立 Calcite RelNode Java模块，先完成 scan/project/filter最小闭环。
4. 完成 join/aggregate和最小 differential runner后，对209119只生成 staging report，审核成功率、映射率、metadata增益、Unknown变化和冲突。
5. 若价值门禁未通过，停止扩展并保留最小离线工具；若通过，再实现 setop/window/Top-N。
6. 迁移仓库内文档、fixture和显式 differential命令到新命名；旧入口继续转发。
7. 生产侧车接入无论门禁结果如何都必须另开 OpenSpec change。

回滚时删除或禁用新 differential命令和 Java模块即可；默认 pipeline未迁移，因此不需要回滚 canonical数据或旧 artifacts。
