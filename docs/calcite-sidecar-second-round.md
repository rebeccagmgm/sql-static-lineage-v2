# Calcite Sidecar 第二轮边界记录

状态：已完成实现和定向验证，停在审批前；未推送、未合并 main。

基线是主仓 `2403429`，当前主仓分支为
`codex/slim-main-calcite-boundary`。独立 Sidecar 使用精确目录
`E:\02_area\股衍数据-数据cookbook\scripts\Calcite`，该目录内有独立 Git，未在父目录初始化或写入 Git。

## 文件处置

| 主仓原文件                                                                        | 当前处置                                                     | 边界理由                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/calcite-differential/plan-facts-rel-projector.ts`                        | 迁至 `Calcite/native-input/plan-facts-rel-projector.ts`      | 只把 canonical Plan Facts 关系形状投影为版本化 `PLAN_FACTS_REL_V1`；不做跨 Task 因果。                                         |
| `scripts/calcite-differential/schema-type-projection.ts`                          | 迁至 `Calcite/native-input/schema-type-projection.ts`        | 只构造 Calcite schema/type；DDL 读取器也改为 Sidecar 内的 `native-input/ddl-schema.ts`，不再依赖主仓 parser/provider。         |
| `scripts/calcite-differential/machine-facts-gate-input.ts`                        | 迁至 `Calcite/native-input/machine-facts-gate-input.ts`      | Sidecar 直接读取 canonical Machine Facts、table DDL 和 hash/identity gate；不重新生成或发布主仓 artifact。                     |
| `scripts/calcite-differential/calcite-rel-boundary.ts`                            | 从主仓删除                                                   | wire protocol 和 Rel graph contract 已由 Sidecar 根目录的 `protocol.ts`、`plan-facts-rel-contract.ts` 承担，未复制第二份边界。 |
| `scripts/calcite-differential/project-machine-facts-gate.ts`                      | 迁至 `Calcite/native-input/project-machine-facts-gate.ts`    | 仅编排 canonical artifact 到请求 JSONL 的 Sidecar 输入阶段。                                                                   |
| `scripts/reconcile/consumer/target-field-causal-slice/calcite-causal-evidence.ts` | 迁至 `Calcite/candidate-evidence/calcite-causal-evidence.ts` | 只生成独立、版本化 candidate evidence；不生成 semantic dependency、edge、assessment、negative proof 或 target closure。        |

对应专项测试也已迁移到 Sidecar 的 `native-input-test.mjs`、
`candidate-evidence-test.mjs` 和 `native-artifact-test.mjs`。主仓原
`default-path-regression.test.ts` 不是 Calcite 语义实现，而是 Native 保护测试，
因此改名保留在 `tests/target-field-causal-slice/`。主仓的
`--semantic-oracle`、`--calcite-mapping-report` 和
`--calcite-causal-evidence` 只保留 fail-closed 拒绝提示，防止旧调用误把
Sidecar candidate 当作 canonical 输入；没有保留 Calcite producer/consumer。

未使用的 canonical artifact `calciteCausalEvidence` overlay 字段也已从
`causal-slice-contract.ts` 删除。主仓 209119 历史 Calcite failure fixture 已移到
Sidecar `fixtures/legacy/209119-no-go.json`；它明确是 `NOT_EVALUATED`，不是业务
负面结论。`target-table-upstream-causal-closure`、target write identity、candidate
universe、跨 Task propagation、Native 主链和 canonical causal artifacts 均未移动。

## 代码量与提交

以 `2403429` 为比较点，排除本轮两份迁移记录文档后，主仓功能/删除 Git diff
为 `+2/-6760`，净减少 6758 行；文档另增加 121 行。64 行 Native 默认路径保护
测试只是目录/描述调整，并非删除；其余删除的是 Calcite 专属生产实现、专项测试、
旧命令、overlay 字段和主仓历史 fixture。`package-lock.json` 未变化。

主仓提交（均在当前分支，未推送）：

- `7017b5c refactor: remove migrated Calcite main implementations`
- `75c06ba chore: remove migrated Calcite commands`
- `865ec0e refactor: remove stale Calcite artifact overlay`

Sidecar 独立提交（分支 `master`，精确目录内）：

- `83cf77e refactor: move Calcite native input and candidate evidence`：新增 Sidecar 输入投影、candidate evidence、artifact runner 闭环及专项测试，Git diff `+5407/-8`。
- `c620434 test: relocate legacy Calcite failure fixture`：迁移历史 `NOT_EVALUATED` fixture。
- `873c7e2 docs: document canonical artifact roundtrip`：记录新的 artifact/process contract 和测试入口。

主仓文档提交为 `45334fc`、`7c9e016`、`491d66b` 及本记录修订提交；当前
分支指针以下方 `git status`/`git log` 命令为准。

当前主仓没有 `scripts/calcite-differential`、`scripts/calcite-oracle` 实现目录，
也没有主仓 Calcite producer。剩余的 Calcite 字样仅是 canonical contract 中已有的
stale-layer/proof-ref vocabulary，以及旧参数的拒绝 guard；它们不读取 Sidecar、
不写 artifact、不参与 Native 默认路径。没有残留 Calcite 实现或运行入口。

## 验证结果

Sidecar 在独立目录执行并通过：

```powershell
Set-Location 'E:\02_area\股衍数据-数据cookbook\scripts\Calcite'
npm test
npm run test:native-input
npm run test:candidate-evidence
npm run test:artifact
```

`npm test` 完成独立 Java 编译、既有 differential/semantic-shadow 测试和三条
迁移测试。`native-artifact-test.mjs` 实际写入临时 canonical-style bundle，读取
artifact 后完成 Node 投影、Java bridge JSONL 往返，并断言 response
`status=SUCCESS`、有效 observations、`INDEPENDENT_CALCITE_CANDIDATE_EVIDENCE_BATCH`
以及三个安全标志全为 `false`；canonical sentinel hash 未改变。

删除后主仓执行并通过：

```powershell
Set-Location 'C:\Users\13246\.codex\worktrees\0bdd\sql-static-lineage'
npm run typecheck
npm run build
npm run test:causal-slice
npm run test:target-table-causal-closure
git diff --check
```

结果为 causal-slice `15` 个测试文件、`108` 个测试通过；target-table closure
`1` 个测试文件、`19` 个测试通过。未执行主仓全量 `npm test`，遵照本轮“不要新增
验证矩阵”的收缩要求；Sidecar 的正式 `npm test` 已执行。

依赖/残留扫描命令：

```powershell
rg -n --glob '!node_modules/**' --glob '!dist/**' --glob '!target/**' `
  'scripts/calcite-differential/|calcite-rel-boundary\.ts|scripts/reconcile/consumer/target-field-causal-slice/calcite-causal-evidence\.ts|calcite-differential:project|test:calcite-differential' `
  scripts tests tools package.json package-lock.json

rg -n --glob '!target/**' --glob '!staging/**' --glob '!node_modules/**' `
  'sql-static-lineage|from ["''].*(scripts|src)/|E:\\02_area.*sql-static-lineage|calcite-rel-boundary' .
```

两条扫描均无输出。Sidecar 没有主仓源码 import、绝对源码路径或共享
`node_modules`；主仓没有对 Sidecar 目录的源码 import。Native 默认 package 命令
和 pipeline 不引用 Java/Maven/Sidecar/Neo4j。

## 未解决限制

- 当前机器没有 `mvn`；Sidecar `npm test` 使用独立目录内的 `javac` 加锁定的本地
  Maven cache 完成真实构建，`pom.xml` 仍可在具备 Maven 的环境中使用。
- Sidecar 只消费 hash/identity 通过的 canonical Machine Facts relation rows 和 DDL，
  不重新运行主仓 SQL parser；不完整输入会保持 `PARTIAL`/`UNSUPPORTED`，不会猜测。
- 本轮没有增加 join/aggregate 等未完成 operator 语义，也没有把 Sidecar candidate
  接回 canonical causal closure；`--semantic-oracle calcite` 需显式走 Sidecar
  `CALCITE_SEMANTIC_SHADOW_V1` process/file contract。
