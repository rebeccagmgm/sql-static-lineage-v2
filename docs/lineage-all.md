# 统一血缘流水线

`lineage:all` 将一个或多个任务串成同一条证据流水线：

1. Input Pack 自动补齐（仅做任务/表的输入闭包，不产出 One-hop/Multi-hop）；
2. 生成或复用长期 Machine Facts（`field-facts/`）；
3. 固定 Producer Index，并对闭包任务实时预取 Horae relation（全局并发默认不超过 4），生成 one-hop 快照；
4. 基于冻结的 one-hop 快照生成 multi-hop；
5. 按需生成字段血缘，并由 JSON 产物生成 HTML。

闭包阶段只读取 SQL 中的表引用和本地 Producer Index 中的确认生产者，并调用已有 collector 补齐缺失 Input Pack；不会把 Horae 的所有调度父任务或未经本地索引确认的元数据候选盲目当成生产者，也不调用 One-hop/Multi-hop。这样 One-hop 的正式输入边界仍是 Input Pack、Producer Index 和冻结 fingerprint。

串联阶段对 `checkdbflag` 做硬过滤：这类任务可以保留为调度侧证据，但不会进入正式 Multi-hop 的数据关系、字段 `VALUE_FLOW` 或字段缺口。已有 Input Pack 通过 `taskCategory` 识别；缺失 Pack 的 Horae 检查节点使用稳定的 `checker.` 任务名约定识别。

`config/multi-hop-terminal-table-rules.json` 是所有扩展阶段共享的 terminal/reference 表配置。`lineage:all` 会把同一份已校验配置传给 Input Pack closure、one-hop、字段驱动补链和 multi-hop：命中的表仍保留为当前 SQL 的直接读表证据，但不会查询 producer、补入 producer Task 或进入 `finalUpstreamTaskIds` 递归集合；原始调度关系仍作为证据保留。它不删除静态 SQL，也不替代当前 Task 所需的 Table Pack 身份/DDL 证据。

示例：

```powershell
npm run lineage:all -- --task-ids 155015,181058,176827,209119 `
  --data-root "E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data" `
  --with-fields
```

正式产物固定在输入根目录下，不使用公开 `run-id` 或 `manifest.json`：

```text
artifacts/tasks/<task-id>/
├─ input-pack-closure.json # 本次运行实际使用的闭包范围证据
├─ one-hop.json
├─ multi-hop.json
├─ field-lineage.json       # 仅 --with-fields
└─ views/
   ├─ table-lineage.html
   └─ field-lineage.html    # 仅 --with-fields
```

Machine Facts 使用输入根目录下已有的 `field-facts/` 长期缓存，并按任务输入内容哈希增量复用；它不会改变上述正式目录契约。Producer Index 默认使用输入根目录外的固定可变文件 `<data-root>.producer-index/producer-index.json`：存在则直接加载，不按整仓 fingerprint 寻址；仅在索引缺失/损坏，或本轮补采了新 Pack 时全量重建。Horae relation 使用固定的 read-through 缓存：`E:\02_area\股衍数据-数据cookbook\sql-static-lineage-cache\schedule-evidence\tasks\<taskId>\horae-relation-up-depth-1.json`。缓存命中且 schema、Task ID、方向、深度、行记录和内容 SHA-256 校验通过时不访问 OpenCLI；缺失或校验失败才实时查询，成功结果原子写入。缓存是可删除的派生证据快照，没有 TTL，需要刷新时删除对应 Task 文件即可。查询失败、超时、非法 envelope 或缺失任务键都会 fail closed。所有下游阶段复用闭包返回的同一 Producer Index；发布前不再做整仓 Input Pack fingerprint 对账。

`input-pack-closure.json` 保存初始闭包、字段驱动补入的生产任务、最终任务集合、发现表、轮次和 Producer Index fingerprint。字段驱动补链不会重新从根任务展开新任务的全部 JOIN；直接/间接上游的分类仍以 `multi-hop.json` 为准。

未显式传 `--max-depth` 时，编排器默认最多追溯 25 层；仍可用 `--max-depth` 覆盖。默认 `maxTasks=1000`、`maxEdges=10000`，Input Pack 闭包的默认发现上限为 5000；字段血缘另有 `maxStates=5000`、`maxPaths=10000` 的默认上限。这些仍是独立的 fail-closed 安全上限，也可通过各自命令行覆盖。

每个任务独立加锁、构建和发布。某个任务失败时保留其原正式目录，并让命令以非零状态结束；成功任务仍可发布。Windows 若因浏览器或文件查看器打开旧产物而拒绝旧目录改名，编排器会退回到该正式目录内逐文件覆盖；若具体文件本身也拒绝写入，则仍失败并保留原错误边界。
