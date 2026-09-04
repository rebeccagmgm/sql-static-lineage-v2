## Context

现有 `projectTaskLocal` 已有 Facts 读取、字段/控制边和读次级分区谓词，但读取边仍
直接连接 TASK 与表。`inferTaskDefaultSchema` 已提供 `TASK_NAME`/`TASK_TARGET` 佐证，
Facts 也已生成任务内 materialization 记录；WP-7 只把这些证据投影出来。

## Decisions

### Contract compatibility

`TASK_LOCAL_PROJECTION_SCHEMA_VERSION` 的当前生产值为 `1.2.0`。验证器接受 `1.1.0`
和 `1.2.0`，canonicalizer 尊重输入版本；只有新的 `projectTaskLocal`/coverage helper
生成 1.2.0。缓存 key 使用当前版本，因此旧缓存自然 miss。

### Identity

`resolveTaskLocalTableIdentity` 先规范化原始表名；裸名只允许通过
`inferTaskDefaultSchema` 补 schema。catalog singleton 且非 `default` 数据源才能提供
物理身份；裸名只有 `TASK_TARGET` 佐证时 qualification 才是 confirmed，只有
`TASK_NAME` 时记为 `ASSUMED(TASK_NAME_ONLY)`。冲突、缺 catalog 或多匹配只输出
`CANDIDATE_DATASET` 与 reason code。resolver 不访问 `byNameTail`。

### Read occurrence shape

每个 read occurrence 产生一个 `read-occurrence:*` 节点；两条 `READS` 边分别为
`TASK → READ_OCCURRENCE` 与 `READ_OCCURRENCE → PHYSICAL_DATASET`。后者承载
`partitionPredicates`/status 和 occurrence 身份；无 occurrence id 的旧 Facts 以
statement + dataset + ordinal 生成稳定 legacy occurrence。

### Local materialization fold

按 `(physical_dataset,column)` 建立 Facts materialization 索引；展开时优先用当前读表达式
的 `read_expression_ids`，其次用 `read_statement_id` 做精确筛选。仅对应候选唯一、状态为
`RESOLVED` 且有 `output_binding_id` 的行递归展开到其 output binding 的物理输入，循环、无
binding 或同一读次存在冲突时保留原 temp field。`AMBIGUOUS`/`UNRESOLVED` 不折叠并带
boundary reason。折叠只影响当前投影的字段来源边和 `localFieldPaths` 摘要，不写回 Facts。

### Self-read and closure summary

最终写表定义为 Pack target（没有 target 时为非 temp 的写表）。读次身份与任一最终写表
相同则 `readDisposition=SELF_READ`；它仍保留谓词和 occurrence 节点，但不创建 task
节点。`finalWrites` 只列最终 write observation，`externalReads` 只列非自读 occurrence，
`localFieldPaths` 记录折叠后的 source field → target write/output column。

## Risks and limits

1. 1.2.0 读取方（data-graph UNION）尚未在本包改造；本包只确保产物契约和旧版本
   兼容，WP-8 负责接入。
2. 没有 read occurrence 的旧 Facts 只能生成 legacy occurrence，不能凭空分裂读次。
3. 字段 resolver 的既有 SQL/Schema 语义不在本包重写；materialization fold 只在已有
   RESOLVED 物理字段上生效。
