# 离线 from-cache 全量：PARTIAL 深入分析

> 数据来源（合并最新）：  
> `tmp/from-cache-full/logs/summaries.jsonl`  
> `+ logs-oracle2hive-refresh/` · `logs-oracle2hive-svc-suffix/` · `logs-oracle2hive-hive-ddl-force/`  
> `+ logs-oracle2hive-wind-uip/` · `logs-oracle2hive-wind-hive-ddl-force/`  
> 批次：`need-create` **11642**（正式根；后续对子集 `--force` 重写）  
> 机器可读明细：`tmp/from-cache-full/partial-analysis/`  
> **文档对齐时间：2026-09-03**。§1–§6 / §8.8–§8.9 保留为 2026-09-02 晚的合并历史快照；本轮逐项修复后的权威结果见 §10。不要用历史章节中的“当前”数字代替 §10 的最终 inventory。

## 1. 结论摘要（当前合并）

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| SUCCESS | **5039** | 任务 + 表证据齐，可当完整 Pack |
| **PARTIAL** | **6363** | **Pack 已落盘**，但按契约标「不完整」 |
| FAILED | **238** | 校验失败，未形成合法 Pack |
| EXCLUDED | 2 | force 子集中排除 |

相对首轮写入（SUCCESS 3195 / PARTIAL 8209）：PARTIAL **−1846**。  
相对 Hive DDL force 后快照（SUCCESS 4725 / PARTIAL 6677）：本轮 wind 全流程再 **+314 SUCCESS / −314 PARTIAL**。  
非 o2h 大头（hiveTask 空 SQL、其它类型 `HIVE_DDL_MISS`）几乎未动。

PARTIAL **不是失败、也不是没写盘**。判定来自
`inputCollectionStatus`（`scripts/input/shared/task-endpoints.ts`）：

```text
PARTIAL ← 任一为真：
  · 候选表解析结果条数为 0
  · 存在未解析表（tablesUnavailable）
  · missingQuery（组装后没有 sql.query）
  · （本路径未启用）端点冲突 / 引用不可用
```

### 1.1 本轮已落地（相对首轮）

| 动作 | 效果 |
| --- | --- |
| `*2hive` 不再把 `source` 数据源标签当表候选 | 去掉 `oracle_*_x.y` 假 miss |
| `horae-datasource` + `#svc` 后缀消歧 | `oracle2hive` AMB 大降；例 `68` → SUCCESS |
| `fill-hive-ddl-from-log` + force（1341） | 仅 Hive 目标缺口 **1341→45** |
| wind `#winddb` → UIP prefer + hive-ddl-from-log（315） | 该批 AMB **清零**；**+314 SUCCESS**，余 1 DDL AMB（§8.9） |

`oracle2hive` **当前**：SUCCESS **2155** / PARTIAL **809**（AMB **711** · RDBMS DDL **~53** · 其它表缺口 **~45**）。详见 §8.8–§8.9。

---

## 2. PARTIAL 三大桶（互斥，当前 6363）

| 桶 | 数量 | 占比 | 说明 |
| --- | ---: | ---: | --- |
| **A. 表目录缺口** | **4806** | 75.5% | 有 `warnings` / `tablesUnavailable` |
| **B. 空 SQL 身份包** | **~1523** | 23.9% | 无表警告，磁盘 `sqlFiles: []`（数量相对首轮几乎未变） |
| **C. 有 SQL 但缺 query** | **~34** | 0.5% | 多仅有 `truncate`，无 `query` |

### 2.1 A — 表目录缺口（主因）

警告码（一条任务可多码，故出现次数 ≥ 任务数）：

| 警告码 | 出现次数 | 涉及任务数 | 含义 |
| --- | ---: | ---: | --- |
| `HIVE_DDL_MISS` | 4495 | 3185 | Hive DDL jsonl 无该表 |
| `RDBMS_CORE_AMBIGUOUS` | 1777 | 1752 | RDBMS 核心同名多行，拒绝对账 |
| `TABLE_JSONL_MISS` | 1249 | 1140 | 元数据/核心均找不到 |
| `HIVE_DDL_AMBIGUOUS` | 74 | 70 | Hive DDL 多行歧义 |
| `RDBMS_DDL_MISS` | 65 | 65 | 有核心无 DDL |
| `RDBMS_DDL_AMBIGUOUS` | 7 | 7 | RDBMS DDL 歧义 |
| `SQL_CREATE_CONFLICT` | 1 | 1 | 任务 CREATE 与目录冲突 |

**按类型（表缺口 PARTIAL）**

| taskCategory | 数量 | 主导警告（当前） |
| --- | ---: | --- |
| hiveTask | 1007 | HIVE_DDL_MISS |
| **oracle2hive** | **809** | **RDBMS_CORE_AMBIGUOUS**（主，**711**）→ DDL / 冷门 MISS |
| mysql2hive | 742 | HIVE_DDL_MISS → RDBMS_CORE_AMBIGUOUS |
| sparkIndex | 681 | HIVE_DDL_MISS |
| hiveTask-2.0 | 419 | HIVE_DDL_MISS |
| postgre2hive | 315 | HIVE_DDL_MISS / RDBMS_CORE_AMBIGUOUS |
| hive2oracle | 206 | TABLE_JSONL_MISS / RDBMS_CORE_AMBIGUOUS |
| hive2mysql | 163 | RDBMS_CORE_AMBIGUOUS |
| hive2postgre | 134 | 同上 |
| qualityTask | 117 | TABLE_JSONL_MISS |
| hive2starrocks | 87 | RDBMS_CORE_AMBIGUOUS |
| 其他 | … | 见下方 §3 |

首轮典型例 `oracle2hive/68` **已转 SUCCESS**（消歧 + `hive-target-ddl.sql`）。  
当前 o2h 主矛盾见 §8.8–§8.9（**空 source ~481**；有 source 仍歧义 ~230，如 xir/ta5/jgj）。

→ **压 PARTIAL 的主杠杆（当前）**：① o2h AMB **711**（空 source 回填优先）；② 非 o2h 的 Hive DDL
覆盖；③ 空 SQL 身份包（可接受或补缓存）。

### 2.2 B — 空 SQL 身份包（次因，数量未变）

无表警告，但 Pack 只有调度身份，`sqlFiles: []`，`tablesWritten: 0`。

| taskCategory | 数量 | 说明 |
| --- | ---: | --- |
| hiveTask-2.0 | 678 | 抽样看缓存也无 `hive-task.sql` |
| hiveTask | 286 | 同上 |
| exeSql | 216 | 无 SQL 槽属预期偏身份 |
| checkdbflag | 131 | 校验类，常无业务 SQL |
| checkHdfsFlag | 115 | 同上 |
| sparkScript | 23 | log 无 `待执行sql为`，抽不到（已放弃强补） |
| runScript / runScript-2.0 | 12+9 | 缺可用 `run-script.sql` 或 UNAVAILABLE |
| mongo2hive / file2hive / hiveEmail / alert 等 | 余量 | 身份或通道配置，无 query |

→ 与「表 jsonl」无关；要减这批需补 hive-task / run-script 缓存，或接受
校验类/脚本类身份 Pack。

### 2.3 C — 有 SQL 但缺 query（~34）

多数 `hive2*`：**只有 `truncate`，没有 `query`** → `missingQuery` → PARTIAL。  
例：`hive2oracle/6456` — `sqlFiles: [truncate]`，target 已落，仍 PARTIAL。

---

## 3. 全量 PARTIAL 类型分布（当前 6363）

| taskCategory | PARTIAL | 其中表缺口 | 其中空 SQL | 缺 query（约） |
| --- | ---: | ---: | ---: | ---: |
| hiveTask | 1299 | 1007 | 286 | 6 |
| hiveTask-2.0 | 1101 | 419 | 678 | 4 |
| **oracle2hive** | **809** | **809** | 0 | 0 |
| mysql2hive | 742 | 742 | 0 | 0 |
| sparkIndex | 681 | 681 | 0 | 0 |
| postgre2hive | 315 | 315 | 0 | 0 |
| hive2oracle | 228 | 206 | 6 | 16 |
| exeSql | 216 | 0 | 216 | 0 |
| hive2mysql | 168 | 163 | 3 | 2 |
| hive2postgre | 140 | 134 | 1 | 5 |
| checkdbflag | 137 | 6 | 131 | 0 |
| qualityTask | 117 | 117 | 0 | 0 |
| checkHdfsFlag | 115 | 0 | 115 | 0 |
| hive2starrocks | 87 | 87 | 0 | 0 |
| mongo2hive | 68 | 51 | 17 | 0 |
| file2hive | 37 | 23 | 14 | 0 |
| hive2file | 29 | 29 | 0 | 0 |
| sparkScript | 23 | 0 | 23 | 0 |
| runScript | 12 | 0 | 12 | 0 |
| 其余 | … | | | |

---

## 4. `tablesWritten` 分布（PARTIAL，当前）

| tablesWritten | 任务数 | 解读 |
| --- | ---: | --- |
| 0 | 3161 | 表全没解析上，或根本无表候选 |
| 1–3 | 2435 | 写出部分表，仍有 miss / 或缺 query |
| 4–10 | 662 | 多表任务部分缺口 |
| 11+ | 105 | 大 SQL，个别表 miss 即 PARTIAL |

（相对首轮：`tablesWritten=0` 4427→3161；相对 Hive DDL force 后 3381→3161，与 wind 补齐一致。）

---

## 5. 与 SUCCESS / FAILED 对照

- **SUCCESS 5039**：表解析全中且存在 `sql.query`（及契约其余条件）。
- **FAILED 238**（未入 PARTIAL，本轮未变）：
  - ~231：`SQL_EXACT_TABLE_TARGET` 需要 SQL 目标 + Table evidence
  - ~5：需要 physical target
  - ~2：`partition.src_tbl` 空串  
  清单近似：`tmp/from-cache-full/diff/need-create.txt`。

---

## 6. 建议优先级（当前）

1. **`oracle2hive` AMB 711** — **空 source ~481**（优先从 horae/szdata 缓存回填）；有 source 仍歧义 ~230（xir / ta5 / jgj 等同 `#svc` 多实例）
2. **非 o2h Hive DDL 覆盖**（hiveTask / sparkIndex / mysql2hive 等仍大量 `HIVE_DDL_MISS`）
3. **RDBMS DDL 缺口**（o2h ~53 + 其它少量）
4. **SQL 缓存**：缺 `hive-task.sql` 的 hiveTask；`hive2*` 缺 query  
5. **可接受 PARTIAL**：check* / exeSql / sparkScript；以及 o2h 冷门源表完全不在
   core 的 ~45（EBS/`APPS`/`HR`/`KDBASE` 等）— 不必强追 SUCCESS

已完成、无需再排期：source 标签过滤、`#svc` 消歧主路径、本批 1341 Hive 日志 DDL、**wind `#winddb` UIP 优先 + 日志 DDL**。

---

## 8. 专题：`oracle2hive`

> 机器明细：`tmp/from-cache-full/partial-analysis/oracle2hive-breakdown.json`（首轮）  
> 当前合并桶：见 §8.8–§8.9

### 8.1 先结论（首轮 2655 解剖）

首轮这批 **全部有 `sql.query`**（2655/2655），不是缺 SQL。  
PARTIAL 几乎都是 **表候选解析失败**——每个任务通常同时带着 **3 类候选**：

| 候选从哪来 | 形态举例 | 常见失败码 |
| --- | --- | --- |
| `task.source` | `oracle_rbjygl_85.236` | `TABLE_JSONL_MISS`（本就不是表） |
| SQL `FROM`/`JOIN` | `HS_OPT.COVERSTOCKJOUR` / `CRMII.…` | **`RDBMS_CORE_AMBIGUOUS`** |
| `task.target`（Hive） | `odata_ygt.nygt_t_coverstockjour` | `HIVE_DDL_MISS` 或 `TABLE_JSONL_MISS` |

契约：任一候选 `unavailable` → 整任务 PARTIAL。  
所以常见「三重奏」警告并不表示三件事同等重要——**真正卡死 Oracle 源表的是 AMBIGUOUS**；另外两项经常是标签噪声 + Hive 目标缺 DDL。

### 8.2 任务级警告组合（首轮）

| 组合 | 任务数 | 解读 |
| --- | ---: | --- |
| `HIVE_DDL_MISS` + `RDBMS_CORE_AMBIGUOUS` | 988 | Oracle 源歧义 + Hive 目标有元数据无 DDL |
| `RDBMS_CORE_AMBIGUOUS` + `TABLE_JSONL_MISS` | 818 | Oracle 源歧义 + 标签/镜像完全 miss |
| **仅** `RDBMS_CORE_AMBIGUOUS` | 427 | 只卡在源表歧义（目标可能已写出） |
| 仅 `HIVE_DDL_MISS` | 205 | 源已解析或未抽到 Oracle 名，卡在 Hive |
| 仅 `TABLE_JSONL_MISS` | 124 | 多是标签 / 冷门名 |
| 三码齐全 | 40 | 三重奏完整版 |
| 其它（含少量 `RDBMS_DDL_MISS`） | 余量 | |

触及码的任务数（可重叠）：

- `RDBMS_CORE_AMBIGUOUS`：**2273**（85.6%）
- `HIVE_DDL_MISS`：1276（48.1%）
- `TABLE_JSONL_MISS`：1016（38.3%）
- `RDBMS_DDL_MISS`：22

`tablesWritten`：0 的 1903；≥1 的 752（部分表写出仍因其它候选 fail 而 PARTIAL）。

### 8.3 三条失败码分别是什么

解析顺序见 `resolveOne`（`offline-table-resolver.ts`）：先本地 Pack → Hive DDL/元数据 →（关系型才）RDBMS core+DDL → 否则 `TABLE_JSONL_MISS`。

#### A. `RDBMS_CORE_AMBIGUOUS`（主因）

- **对象**：Oracle `SCHEMA.TABLE`（如 `HS_USER.*`、`HS_ASSET.*`、`CRMII.*`）。
- **原因**：`gf_rdbms_table_core_restored.jsonl` 按 `schema.table` 建索引时，**同名表在多套库/多实例重复**，索引标成 `AMBIGUOUS`，解析器 fail-closed，不猜哪一行。
- 索引现状：`ambiguousKeys` **约 23.4 万**；其中 `hs_*` 约 2.9 万、`crmii.*` 约 0.8 万。例：`hs_user.stkcode`、`hs_opt.coverstockjour`、`crmii.tapp_channeltype` 均在歧义集中。
- 警告里大小写混用（`HS_USER.STKCODE` vs `hs_asset.client`）是候选原文；查找已 lower-case。

**名称形态（按警告次数）**：`ORACLE_SCHEMA.TABLE` ~1209 + 其它 dotted ~1098（多为小写 schema.table）。

#### B. `TABLE_JSONL_MISS`

两类占绝大多数（首轮）：

1. **数据源标签当表**（~368 次）：`oracle_rbjygl_85.236`、`oracle_wande_89.132`、`oracle_jgj_69.202`…  
   来自 `task.source`（平台数据源 ID），`extractOfflineTableCandidates` 对 `source` 也 `add()`，被当成 `qualifiedName`。**此后已对 `*2hive` 过滤。**
2. **Hive 镜像名完全不在目录**（`odata_*` ~898 次）：元数据 + DDL 都没有，落到最终 `TABLE_JSONL_MISS`。**本批 1341 + wind 220 已用日志 DDL 大部补齐。**

真正缺 Oracle 物理表且 core 也没有的很少（首轮 `ORACLE_SCHEMA.TABLE` miss 仅约 24 次）；**当前残留 ~45 则以这类冷门源表为主**（见 §8.8）。

#### C. `HIVE_DDL_MISS`

- **对象**：几乎都是 Hive 目标 / 镜像：`odata_ygt.*`、`odata_jgj.*`、`odata_n_*`、`gf_dcp.*`。
- **含义**：Hive **元数据能命中**（或走到 Hive 分支），但 **DDL jsonl 无可用 `querytext`**，又没有任务侧 CREATE 可兜底 → 不能落 Table Pack。
- 与 AMBIGUOUS 常成对：源表 Oracle 歧义、目标表 Hive 缺 DDL。

### 8.4 典型任务解剖：`68`（首轮 → 现已 SUCCESS）

```text
【首轮】
source  = oracle_rbjygl_85.236          → TABLE_JSONL_MISS（标签）
target  = odata_ygt.nygt_t_coverstockjour → TABLE_JSONL_MISS（或同类 Hive 缺口）
SQL 读  = HS_OPT.COVERSTOCKJOUR         → RDBMS_CORE_AMBIGUOUS
sqlSlots = [query]  ✓
tablesWritten = 0
→ PARTIAL

【当前】
source 标签不再作表候选；COVERSTOCKJOUR 经 horae-datasource 消歧；
target 经 hive-target-ddl.sql 写入 → SUCCESS，tablesWritten=2
```

同一模式曾贯穿 `oracle2hive` 大头（柜台 HS_* / CRMII + odata_* 镜像 + oracle_* 数据源）。

### 8.5 若要降这 2655，建议顺序

1. **候选过滤（收益最大、改动局部）** — **已改**  
   - `*2hive` 不再把 `source` 数据源标签（如 `oracle_rbjygl_85.236`）当表候选。  
   - 见 `extractOfflineTableCandidates` + `isDatabaseSourceToHiveTask`。  
   - 已落盘的 PARTIAL Pack 需 `--force` 重跑才会刷新 warnings。
2. **RDBMS 消歧（真正解锁源表 Pack）** — **已改**  
   - `*2hive` 用 `horae-datasource`：`server_tag` → `service` → 优先查  
     `schema.table@gforacle_<service>#<service>`，避免裸 `schema.table` 的 AMBIGUOUS。  
   - 例：`oracle_rbjygl_85.236` + `HS_OPT.COVERSTOCKJOUR` →  
     `…@gforacle_jyglrac#jyglrac`。  
   - 已落盘 Pack 需 `--force` 重跑才会换掉旧 warnings / 补 Table Pack。
3. **补 Hive DDL（走 Horae 运行日志）** — **已跑完本批**  
   - `*2hive` 目标常不在 Hive DDL jsonl，但日志里有 AnyLoader  
     `Process hive ddl:` → `CREATE EXTERNAL TABLE …`。  
   - 清单从 collect `summaries.jsonl` 取桶 `ONLY_HIVE_TARGET_GAP`  
     （`partial-gap-from-summaries.ts`）。  
   - 填充：`npm run input-pack:fill-hive-ddl-from-log`  
     → 缓存 `tasks/<id>/hive-target-ddl.sql` → 离线组装进 `sql.create`。  
   - 再 `--force` 跑 `input-pack:from-cache` 写进正式根。
4. **winddb 多实例优先 UIP** — **已改并 force**（§8.9）

### 8.7 消歧后剩余 PARTIAL（历史快照：合并至 2419，Hive DDL force 前）

两轮 `--force` 重跑（精确 `gforacle_svc#svc` → 再加 **`#svc` 后缀唯一命中**）：

| 桶 | 任务数 | 含义 |
| --- | ---: | --- |
| **仅 Hive 目标缺口** | **1341** | Oracle 源已消歧；卡在 `odata_*` 等 Hive miss/DDL |
| **仍含 AMBIGUOUS** | **1026** | 源表仍歧义 |
| **RDBMS DDL 缺口** | **52** | core 命中但 DDL miss/歧义 |
| SUCCESS（相对首轮 2655 累计） | **236** | 源+目标都齐 |

`#svc` 后缀一轮（原 1359 AMBIGUOUS）：SUCCESS 35 + 转仅 Hive 293 + DDL 5 → **AMB 降至 1026**。  
例：`124` / `CRMII.TAPP_CHANNELTYPE` — 拼 `gforacle_jgjdb#jgjdb` 不存在，改命中 `…@gforacle_jgjdb1#jgjdb`。

#### 当时仍 AMBIGUOUS 的 1026（§8.9 前）

| 原因 | 约量 | 说明 |
| --- | ---: | --- |
| **task.source 为空** | **~481** | Pack 无 source，无法查 horae-datasource |
| **有 source 仍对不齐** | **~545** | 无 `#svc` 唯一实例、或同 `#svc` 多条 concrete（含 **~315 wind**）、或 core 无该表 |
| source 不在 datasource 表 | **0** | 有 source 的都能查到 |

当时有 source 仍 AMB 的样本：`125`/`143`（`oracle_jgj_69.202`→`jgjdb` + `CRMII.*`）、
`166`/`172`/`185`（`oracle_wande_89.132`→`winddb` + `WIND.*`，**§8.9 已消**）。

### 8.8 Hive 日志 DDL + wind 全流程后（当前）

1. **1341 仅 Hive 缺口**（`fill-hive-ddl-from-log` + force）：SUCCESS **1294** / PARTIAL **45** / EXCLUDED **2**。  
2. **315 wind AMB**（UIP prefer + 日志 DDL + force）：SUCCESS **314** / PARTIAL **1**（§8.9）。

例：`68` → SUCCESS，`tablesWritten=2`，artifacts 含 `hive-target-ddl.sql`。  
例：`166`/`172`/`185`（万得）→ SUCCESS（源 UIP 消歧 + 目标日志 DDL）。

#### 当前 `oracle2hive` 合并存量

| 桶 | 任务数 |
| --- | ---: |
| SUCCESS | **2155** |
| PARTIAL 合计 | **809** |
| └ 仍 AMBIGUOUS | **711** |
| └　空 source | **481** |
| └　有 source 仍歧义 | **230**（xir 94 · ta5 ~55 · jgj/crm 等） |
| └ RDBMS DDL 缺口 | **~53**（含 `66554`） |
| └ 冷门 / 其它表缺口 | **~45** |

#### 残留 ~45：不是「Hive 缺 DDL」

桶名曾沿用 `ONLY_HIVE_TARGET_GAP`，但落盘后重扫警告几乎全是
**源侧/冷门名 `TABLE_JSONL_MISS`**，真正 `odata_*` 很少：

| schema 前缀（小写） | 约出现次数 | 备注 |
| --- | ---: | --- |
| `apps` | 20 | EBS 等，core 无 |
| `kdbase` | 8 | 同上 |
| `hr` | 6 | 同上 |
| `odata_n_icc` / `odata_n_ta5` | 3 | 少数真 Hive 名 miss |
| `temp` / `temp_n` / `gfstest` 等 | 余量 | 临时/测试库 |
| `titans_otcclearing` / `ctsdb` / `gfkn` / `gl` / `hs_taquery` / `tgbsjcl` | 余量 | 冷门库或带 `$` 名 |

例：`557`→`KDBASE.T_YGZCY`；`2297`→`HR.PER_ALL_PEOPLE_F`；`3266`→`APPS.PER_CONTRACTS_F`。

**下一步主攻**：空 source 回填（AMB **481**）→ 再攻有 source 仍多实例（**230**）。45 与 53 体量小，可单列接受或另补目录。

### 8.9 winddb 多实例：优先 `gforacle_oracle_uip_winddb#winddb`（已完成）

同 `service=winddb` 时 core 常有两条 `#winddb`：

- `…@gforacle_oracle_uip_winddb#winddb`（万得/UIP，host `10.2.89.132`）
- `…@gforacle_winddb4#winddb`（另一套实例，**不**配 `oracle_wande_*` / `oracle_uip_winddb*`）

已成功样本 100% 落在 UIP 实例。落地规则（`horae-datasource-cache`）：

> `service=winddb` 且 `#winddb` 多条时，若 source 为 `oracle_wande_*` / `oracle_uip_winddb*`，或 `host=10.2.89.132` → 优先精确键 `…@gforacle_oracle_uip_winddb#winddb`。

对 AMB 中 **315** 条 wind 源：先 UIP prefer `--force`，再对剩余 220
`fill-hive-ddl-from-log`（**cached 220 / empty 0**）+ `--force`：

| 阶段 | SUCCESS | PARTIAL | 仍 AMB |
| --- | ---: | ---: | ---: |
| UIP prefer force | **95** | 220（转 Hive 缺口） | **0** |
| + hive-ddl-from-log force | **+219** | **1**（`RDBMS_DDL_AMBIGUOUS`：`66554`） | **0** |
| **合计** | **314** | **1** | **0** |

日志：`logs-oracle2hive-wind-uip` · `logs-hive-ddl-from-log/fill-wind-partial.log` · `logs-oracle2hive-wind-hive-ddl-force`。  
ID：`partial-analysis/ids-wind-uip-prefer.txt`（315）· `ids-wind-partial-after-uip.txt`（220）。

→ AMB **1026 → 711**（本批 315 条 AMB 清零；空 source **481** 仍是主头）。

---

## 9. 附件路径

| 路径 | 内容 |
| --- | --- |
| `tmp/from-cache-full/partial-analysis/partial-stats.json` | 首轮全量统计 JSON（未含后续 force） |
| `tmp/from-cache-full/partial-analysis/current-partial-snapshot.json` | 消歧后、Hive DDL force **前** 快照 |
| `tmp/from-cache-full/partial-analysis/oracle2hive-breakdown.json` | oracle2hive 首轮专题统计 |
| `tmp/from-cache-full/partial-analysis/ids-ONLY_HIVE_TARGET_GAP-current.txt` | 当时 1341 ID |
| `tmp/from-cache-full/partial-analysis/ids-HAS_AMBIGUOUS-current.txt` | 当时 AMB 1026 ID（§8.9 前） |
| `tmp/from-cache-full/partial-analysis/diagnose-amb-1026.cjs` | AMB 子类探测稿（未并入正文） |
| `tmp/from-cache-full/logs-hive-ddl-from-log/fill-run.log` | 1341 日志抽 DDL 填充摘要 |
| `tmp/from-cache-full/logs-oracle2hive-hive-ddl-force/summaries.jsonl` | Hive DDL 批 force 采集摘要 |
| `tmp/from-cache-full/partial-analysis/ids-table-gap.txt` | 首轮表缺口 ID |
| `tmp/from-cache-full/partial-analysis/ids-warn-HIVE_DDL_MISS.txt` | 首轮含该警告的任务 |
| `tmp/from-cache-full/partial-analysis/ids-warn-RDBMS_CORE_AMBIGUOUS.txt` | 同上 |
| `tmp/from-cache-full/partial-analysis/ids-warn-TABLE_JSONL_MISS.txt` | 同上 |
| `tmp/from-cache-full/logs-oracle2hive-wind-uip/summaries.jsonl` | wind UIP 优先规则 force 摘要 |
| `tmp/from-cache-full/logs-hive-ddl-from-log/fill-wind-partial.log` | wind 220 条日志 DDL 填充 |
| `tmp/from-cache-full/logs-oracle2hive-wind-hive-ddl-force/summaries.jsonl` | wind Hive DDL 补齐后 force |
| `tmp/from-cache-full/partial-analysis/ids-wind-uip-prefer.txt` | 本批 315 wind AMB ID |
| `tmp/from-cache-full/partial-analysis/ids-wind-partial-after-uip.txt` | UIP force 后 220 PARTIAL ID |
| `tmp/from-cache-full/logs/summaries.jsonl` | 首轮逐任务采集摘要 |
| `tmp/from-cache-full/diff/summary.json` | 缓存全乎 vs 正式根 diff |

重算当前合并（需含 wind 两份 summaries）：

```powershell
# 合并 logs + refresh + svc-suffix + hive-ddl-force + wind-uip + wind-hive-ddl-force
node sql-static-lineage-data\tmp\from-cache-full\partial-analyze.cjs
node sql-static-lineage-data\tmp\from-cache-full\partial-analysis\oracle2hive-analyze.cjs
```

## 10. 2026-09-03：逐项修复执行闭环（当前权威结果）

### 10.1 总体结论

本轮先生成稳定 inventory，再按证据类型拆 cohort；每个 cohort 都遵循：

```text
盘点当前 PARTIAL
  → 本地 cache / log / 原信息 jsonl
  → 缺失时才显式启用 MCP/OpenCLI backup
  → 只写入唯一、可对账的 evidence
  → 仅重跑 changed task IDs
  → 重新生成稳定 inventory
```

基线与最终结果：

| 快照 | SUCCESS | PARTIAL | FAILED | 稳定性 |
| --- | ---: | ---: | ---: | --- |
| 基线 `baseline.json` | 5472 | 5938 | 238 | `stable=true` |
| 最终 `final-inventory.json` | **5615** | **5795** | 238 | `stable=true` |
| 变化 | **+143** | **-143** | 0 | 无活跃 writer |

因此，能由现有 log、任务缓存、datasource 映射或本地 Table Catalog 证明的缺口已经实际回写并重跑；剩余 PARTIAL 不是“还没随手试一下”，而是当前证据不足、冲突或上游没有返回，继续写只能猜。

最终 inventory：
`E:\02_area\股衍数据-数据cookbook\sql-static-lineage-data\tmp\from-cache-partial-repair\final-inventory.json`

### 10.2 按缺口逐项处理

| 缺口 / cohort | 检查与处理 | 可安全落地的结果 | 不能继续做的原因 |
| --- | --- | --- | --- |
| `hiveTask` / `hiveTask-2.0` SQL | 2400 个 hive-task SQL 目录；保留 AVAILABLE，force 只重试 UNAVAILABLE；复用本地和 MCP 返回的真实 query | 新增/确认可用缓存 175 个（本地 63、MCP 112）；398 个 changed task IDs 重跑，结果 `SUCCESS 65 / PARTIAL 262 / EXCLUDED 71` | 223 个无 SQL 返回；3 个任务 `70494/70505/70549` 为 OpenCLI 子进程超时，不能把空结果当 SQL |
| `runScript` / `runScript-2.0` | 从 Horae log 选 44 个任务并实际重试 `run-script.sql` | 44 个均写入 `HORAE_LOG` 的 `UNAVAILABLE` 结果，未产生可重跑的 SQL | 日志没有对应实例（`HORAE_LOG_INSTANCE_MISSING`）；不能用 schedule-detail 或 task 名补成 query |
| `*2hive` Hive 目标 DDL | 只选 SQL 写目标与 `HIVE_DDL_MISS` 精确相等的 17 个任务；从日志提取 `Process hive ddl` | 7 个取得唯一 DDL 并写入 `hive-target-ddl.sql`，7 个重跑后全部 `SUCCESS` | 10 个为 `HORAE_LOG_INSTANCE_MISSING`；没有日志 DDL，不能用目标名或任务 CREATE 猜当前结构 |
| 本地 Table Catalog | 1503 个缺表任务先查已有 Table Pack、Hive 元信息/DDL、RDBMS core/DDL；catalog 命中通过正式 writer 落盘 | 4804 条本地表证据被复用；70 条 evidence 发生实际变化（涉及 35 个任务），changed task IDs 已重跑 | 1942 条表证据没有唯一可写结果，主要是 `ONLINE_BACKUP_DISABLED`，另有 11 条手工/冻结任务；不因目录缺行宣称“物理表不存在” |
| `hive2*` 目标表补证据 | 166 个 `TABLE_JSONL_MISS` 任务；本地优先，明确允许 backup 后才查 exact table-search | 发现 20 条可安全写入的远程 Table evidence，涉及 10 个任务；重跑后 3 个 `SUCCESS`，7 个仍有其它 warning | 其余结果为 not found 或多个 GUID；不能从同名候选、relation 或 endpoint 标签任选一个 |
| `hiveTask` 本地补证据复核 | 对已有 task SQL 的 1744 个任务再次只查本地 Table Pack | 1510 个 SQL 缓存命中；64 条表证据变化，涉及 35 个任务；重跑后 `SUCCESS 19 / PARTIAL 16` | 1543 条表证据仍因 `ONLINE_BACKUP_DISABLED` 无法补；没有取得新事实，不重复启动在线查询 |
| RDBMS 多实例歧义 | 对 48 个 `hive2oracle` 任务尝试 endpoint datasource hint + exact `table-search` | 0 条远程表证据写入，避免污染正式 Pack | 即使服务标签唯一，table-search 仍返回多个物理实例/GUID；exact suffix 不能唯一对账时保留 `RDBMS_CORE_AMBIGUOUS` |

`runScript` 和 10 个 Hive DDL miss 的“没有实例”是 log 事实；RDBMS 的多实例是 API 返回的多候选事实；这两类都不能通过扩大匹配规则解决。关系 cache 只作为关系/调度参考，inventory 明确排除 relation-only evidence，不把它算作表、SQL 或字段血缘闭包。

对最终 inventory 的 `HIVE_DDL_MISS` 再按 `hasScriptLog` 交叉检查：共 2865 个任务行，其中仅 17 个有脚本日志，正好是本轮精确选出的 `*2hive` 目标 DDL cohort；其余 2848 个没有可用于抽取 Hive DDL 的脚本日志。因此没有遗漏一批“已有日志但尚未尝试”的普通 `hiveTask` / `sparkIndex` DDL 修复候选。

### 10.3 实现边界

- 新增 `input-pack:partial-inventory`：读取当前 status、schedule-evidence、日志和四类本地 catalog；检测相关 writer，writer 活跃时不发布最终标签。
- 新增 `input-pack:repair-partials`：默认 local-first；只有传 `--allow-online-backup` 才允许对缺失表证据访问在线 table adapter。manifest 记录 provider、`observedAt`、SHA-256、changed 和 failure class。
- SQL / DDL cache 的 force 语义只重试既有 `UNAVAILABLE`；已有 AVAILABLE 内容及 provider 不覆盖。Table Pack 写入要求 qualified name、platform、dataSource、DDL 能互相对账，并采用安全替换。
- Horae datasource 索引遇到不同 server/service/alias 的冲突时 fail-closed；唯一 endpoint hint 只能缩小候选，不能把多候选强行变成唯一表。
- `*2hive` 的 `source` 仍是数据源标签，不是物理表；endpoint hint 是内部证据，不改变 Task Pack wire shape；不写 `default` datasource。

### 10.4 可复核产物

| 产物 | 作用 |
| --- | --- |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\baseline.json` | 修复前稳定基线 |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\final-inventory.json` | 修复后稳定权威 inventory |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\local-table-repair-manifest.jsonl` | 本地表证据命中、变化和失败分类 |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\online-hive2-table-manifest.jsonl` | hive2* 在线 backup 的逐条证据结果 |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\online-hive2oracle-ambiguous-manifest.jsonl` | 48 个多实例核验结果 |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\local-hivetask-table-manifest.jsonl` | hiveTask 本地复核结果 |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\sql-hive-task-ids.txt` | 2400 个 SQL cohort |
| `sql-static-lineage-data\tmp\from-cache-partial-repair\hive-target-ddl-exact-gap-ids.txt` | 精确 17 个 Hive 目标 DDL cohort |

本轮没有把 relation cache、任务名、空 API 返回、同名多实例或“看起来像”的 datasource 当成证据；因此最终 5795 个 PARTIAL 仍需按 inventory 中的 warning 逐类处理，不能整体改成 SUCCESS。

### 10.5 验证记录

本轮实际执行的定向验证均通过：

| 命令 | 结果 |
| --- | --- |
| `npm run test:input-pack:cache-fill` | 21/21 passed |
| `npm run test:input-pack:offline` | 22/22 passed |
| `npm run test:input-pack:from-cache` | 7 files / 61 tests passed |
| `npm run test:input-pack:repair` | 4/4 passed |
| `npm run typecheck` | passed |
| `npm run build` | passed，`sqllens engine ready` |
| `openspec validate close-input-pack-partials --type change --strict --no-interactive` | valid |

以下检查已执行但不能作为本轮代码通过：

- `npm test` 在 `tests/field-lineage.test.ts` 的 30 个测试中报告 14 个失败，随后 Node 以 `-1073740791` 退出。失败集中在既有 field-lineage / multi-hop 行为（primary recursion、same-table producer、task-local materialization、JOIN control 等），没有把这些测试改成通过，也没有把本轮 Input Pack 证据规则放宽。
- `npm run format:check` 报 20 个文件已有格式问题，包括多个未由本轮新增的文档；本文件历史章节已有 Markdown 强制换行的尾随空格。没有对全仓库做格式化重写，以免扩大用户已有 diff。
- `npm run inspect` 的 npm 脚本没有传入必需参数，脚本明确要求 `--facts-root --task-id --question-spec --output`，因此返回 usage；这不是一个可用于本轮 Input Pack 的无参验收命令。

这些验证失败分别属于既有 field-lineage 基线、全仓库格式基线和 inspect 入口参数问题；它们不改变 §10 的 evidence 结果，也不构成把剩余 PARTIAL 改成 SUCCESS 的理由。
