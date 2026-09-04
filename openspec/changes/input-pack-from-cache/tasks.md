## 1. jsonl 表名索引

- [x] 1.1 新增只读 jsonl 表名→offset 索引，GUID 可选；相同内容重复行合并
- [x] 1.2 用截断 fixture 测 HIT / MISS / 同内容合并 / 不同内容 AMBIGUOUS

## 2. Table 离线解析

- [x] 2.1 解析顺序：已有 tables/ → Hive 按表名对 DDL（可无 guid）→ RDBMS 按 qn@ds
- [x] 2.2 Hive DDL MISS 且任务 SQL 唯一 CREATE 时才写 ddl.sql；RDBMS 不用 CREATE
- [x] 2.3 dataSource 前缀映射 platform；对不上不写 Table
- [x] 2.4 fixture 覆盖 gfhive 无 guid、guid 不一致仍按表名拼接、180065 Oracle
- [x] 2.5 RDBMS partitionFields：可解析 PARTITION BY 写列名；RANGE (null)/ispartitioned 省略字段，不得写 []

## 3. TaskEvidence 类型路由

- [x] 3.1 sparkIndex：复用现有 builder，只读 HIT，禁止 OpenCLI runner
- [x] 3.2 hiveTask / hiveTask-2.0：从 hive-task.sql 取 create/query
- [x] 3.3 runScript / runScript-2.0：从 run-script.sql 取 query
- [x] 3.4 `*2hive`：Horae querySql + syncInfo target；source 保持数据源标签
- [x] 3.5 `hive2*`：syncInfo 端点 + 已有 SQL 槽；缺 query 标 PARTIAL
- [x] 3.6 无 SQL 非加工类 SKIPPED；relation 缓存不参与

## 4. 离线入口

- [x] 4.1 新增 `collect-input-pack-from-cache.ts` 与 `npm run input-pack:from-cache`
- [x] 4.2 手工/冻结归档 manual-tasks；两边都无记录归档 not-found；表缺口 PARTIAL 留主根
- [x] 4.3 已有合法 Pack 默认 skip；SQL 更少时不覆盖
- [x] 4.4 复用 `materializeTaskAndTablePacks` 与现有 status 文件约定

## 5. 验收

- [x] 5.1 单测覆盖上述场景，加入 `package.json` 的 `test` / 专用 script
- [x] 5.2 `npm run typecheck` 与 `npm run test:input-pack:from-cache` 通过；全量 `npm test` 待回归
- [ ] 5.3 可选：对 100931 / 62190 / 180065 / 一个 hiveTask 做 dry-run 对照，不作为单测依赖
