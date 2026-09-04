# 价值场景清单：股衍 titans → dm_otc_n（2026-09-04）

本文记录图谱**面向业务的应用场景**（§1）、**现有架构能否支撑**（§2）、及其背后的
**技术能力场景**（§4，原 A–D），包括已用真实 Facts 验证到什么程度、还缺什么、诚实边界。
§1 与 §4 **并存**：§1 是要交付什么、给谁用；§4 是机器层已有/将有什么能力，以及如何支撑 §1。

## 0. 讨论的起点与结论

起点：想从 992 个 dm_otc_n 相关调度出发理解业务地图 / 数据地图，按 Horae relation
闭包展开得到 83 823 个任务，画出来没有用，进而怀疑整套图谱架构是否偏离实际需求。

结论：

- **架构没偏。** Horae relation 是调度图，架构 §3.3 本来就禁止 TASK→TASK 数据边、
  调度只做 L0 归因。8 万任务不该进数据图，不该去展开。
- **偏的是产出物。** 已有 Facts、Projection、Index，但没有任何一个面向人的出口，
  所以看不到价值。缺的是消费端（渲染器 + 可查的装载），不是上游设计。
- **单任务、单表、人读的场景下，Facts 对 LLM 没有优势**，直接丢 SQL 给 LLM 效果一样。
  Facts 的价值只在：`*` 展开与物理列绑定、跨几百张表的横向查询、答案可回溯到 span。
- **范围是几百个写者，不是 8 万任务。** dm_otc_n 约 380 张表 / 409 个写者，加 pdata/odata
  上游写者，Facts 总量约 100 MB 级。

## 1. 图谱应用价值场景（确认的落地方向）

以下三个场景是股衍侧对图谱的**主要应用意图**。数据主链固定为：

```text
titans_dm（股衍源头 / Titans 落 Hive）
    → odata_n_tit（oracle2hive 入仓）
    → pdata_n / pdata_nds（模型层，常按 src_tbl 分区）
    → dm_otc_n（大数据加工后汇入股衍集市）
```

**不纳入本链的范围**（另立场景或后续再做）：Horae 调度闭包、8 万任务图、主源为 OIS/RCC/CRM
的销售收入报表线、`dm_index_n` 行级指标目录（需 `index_id` 权威目录，见
`execution-plan-asset-graph.md` §明确不在本方案内）。

### 场景 V1：指标口径归并（titans_dm 锚点 → dm_otc_n 成员）

| 项 | 说明 |
| --- | --- |
| **要回答** | Titans 里这个字段，到集市层变成了哪些名字？直通还是派生？能否算同一指标？ |
| **锚点** | `titans_dm.{表}.{列}`（股衍源头标准侧） |
| **终点** | `dm_otc_n.{表}.{列}`（加工后落集市） |
| **原则** | 归并在**物理节点**，不合并 DDL 注释文本；冲突项禁止自动归并 |
| **产出** | `titans_dm` 指标登记表：标准锚点 → 成员列表（直通 / 派生 / 冲突）+ 差异矩阵 |
| **映射技术场景** | §4 **C**（族谱分桶）+ **D**（正向穿透，v1 需补 pdata 写者 Facts） |

成员关系（机器建议，人裁定）：

| 关系 | 含义 | 可否归入同一标准指标 |
| --- | --- | --- |
| 直通 | 搬运或改名 | 是 |
| 派生 | 含运算、分支、窗口 | 是，须标派生形式 |
| 同名异源 | 列名相同，物理来源不同 | **否** |
| 疑似错 | 列名与表达式语义不符 | **否**，进待核实 |

### 场景 V2：资产 / 宽表冗余审计（重复加工嫌疑）

| 项 | 说明 |
| --- | --- |
| **要回答** | 哪些 dm 表 / 宽表在读同一批上游、落地同一批列？是否重复建设？ |
| **范围** | 优先 titans → dm 链上的表（如 TRS 宽表群、镜像表）；OIS 源报表线单列 |
| **产出** | 冗余候选清单：表对上游 Jaccard、列重叠度、加工形态；宽表群簇；titans 扇出 > N 的落点 |
| **映射技术场景** | §4 **B**（分群与公共上游）+ **C**（同源扇出）+ SQLite 表级相似度查询 |

已观察到的结构信号（68 份 dm Facts，待正式审计确认）：

- **镜像重复**：约 23 张 dm 表只读 1 张上游、无分支/聚合（如 `ctp_asp_*` 7 张）。
- **宽表群重复**：`d_v_equity_trs_*`、`v_equity_trs_underlying` 等共读 `t98_sb_otc_swap_comp_info`
  同名本金列，多表直通搬运。
- **同源扇出**：单物理列喂多个 dm 输出（如 `dyna_nom_prin` 相关 11 个下游列）——未必错，但需说明是否必要。

### 场景 V3：乱加工治理（口径与实现不一致）

| 项 | 说明 |
| --- | --- |
| **要回答** | 哪些实现「名字、来源、粒度、表达式」对不上，存在治理风险或疑似 bug？ |
| **产出** | 红牌清单：同名异源、名实不符、同表达式不同名、窗口分区不一致、表达式 PARTIAL 未解析 |
| **映射技术场景** | §4 **C**（冲突桶）+ §4 **A**（单表表达式与粒度，用于核实） |

已记录样例（名义本金族）：`accum_absl_nom_prin` 与 `accum_dyna_nom_prin` 表达式相同；
`dyna_nom_prin` 五源同名；`accum_dyna_nom_prin` 分区键跨表不一致。

### 三场景共用交付包（v0 可验收）

一次 Facts 扫描，出三份清单（CSV / SQLite 视图），而非三张无关图：

| 交付物 | 场景 | 读者 |
| --- | --- | --- |
| Titans 指标登记表 | V1 | 口径负责人、对账 |
| 冗余候选清单 | V2 | 架构 / 建模 |
| 乱加工红牌清单 | V3 | 治理、排障 |

**v0 范围**：已有 titans oracle2hive Facts（约 122 任务 / 74 表）+ dm_otc_n 写者 Facts（约 81 份）；
先跑 TIT 源宽表群 + 名义本金等种子概念。**v1**：补 pdata/odata 写者 Facts，链接完整链。

### 与「业务全貌」的关系

业务全貌（§4 场景 B）是**集市视角的压缩地图**（分几块、代表表、公共维），服务新人/onboarding。
V1–V3 是**源头视角的治理清单**，服务口径归并与资产收敛。共用 Facts 底料，**交付形态不同**，
不互相替代。全貌可作为第四份可选交付（目录页），链到 V1 登记表。

### 价值场景 ↔ 技术能力映射

| 应用场景 | 技术场景（§4） | 新增消费端（待建） |
| --- | --- | --- |
| V1 口径归并 | C + D | `indicator-caliber-registry` |
| V2 冗余审计 | B + C | `asset-redundancy-audit` |
| V3 乱加工治理 | C + A | `caliber-anomaly-list` |
| 全貌（可选） | B | 五页压缩地图渲染器 |

## 2. 现有技术架构能否支撑 §1

**结论：能。** 分场景、分版本交付；瓶颈在**消费端未建**与 **Facts 覆盖未铺到 pdata**，
不在架构设计。Facts + Projection + Index + Impact Query（Phase 2 已完成）正是为
「物理列锚定、跨表横向查、跨任务带状态穿透」而设计，与 V1–V3 一致。

### 2.1 总览

| 应用场景 | v0（现有 Facts 出草稿） | v1（补覆盖 + 消费端） | 架构硬缺口 |
| --- | --- | --- | --- |
| **V1 口径归并** | 能：titans→odata→dm 局部链 | 能：链补全 | 无 |
| **V2 冗余审计** | 能：dm 表级相似度 | 能：覆盖更全 | 无 |
| **V3 乱加工红牌** | 能：规则类候选 | 能：规则更准 | 无 |
| 自动拍板归并 | **不能** | **不能** | **设计如此**（人裁定） |
| `dm_index_n` 行级指标 | 不能 | 不能 | 需权威 `index_id` 目录，另立项 |

架构文档（`domain-asset-graph-architecture.md` §边界）已写明：归并发生在物理节点、
不合并口径文本——与 V1 一致。`execution-plan-field-evidence-v1.md` 的 Impact Query
即场景 D，方向为「从源列/锚点向下游追」。

### 2.2 分场景：已有能力 / 当前缺口 / 判断

#### V1：titans_dm → dm_otc_n 口径归并

| 已有（架构 + 仓库） | 说明 |
| --- | --- |
| 单任务字段边 | `field-expression-nodes.input_fields` → 物理列；`PHYSICAL` / `PARTIAL` |
| titans 入仓段 | 约 122 个 oracle2hive 任务、74 张 `titans_dm` 表有 Facts；列级多为直通 |
| dm 集市段 | 约 81 份 dm_otc_n 写者 Facts；名义本金族（160 列）已验证同源/同义/冲突分桶 |
| 跨任务 | `continuation index`、`scripts/project-graph/field-evidence-v1/impact-query.ts` |

| 缺口（非架构） | 说明 |
| --- | --- |
| pdata 写者 Facts | odata → pdata 段链断；v1 需补 otc 闭包内几百个写者 |
| dm 写者未齐 | 约 409 写者中大量未跑 Facts |
| 消费端 | 无 `indicator-caliber-registry` 导出；需 SQLite + 发现脚本 |
| DDL 注释 | WP-2 声明口径层未接；标准侧展示名靠 Table Pack + 人 |

**判断**：v0 可交付 TIT 宽表群 + 种子概念的登记表草稿；v1 补 pdata 后全链。无需改架构。

#### V2：冗余 / 宽表重复加工审计

| 已有 | 说明 |
| --- | --- |
| 表级 I/O | `dataset-io`：每张 dm 表的 READ/WRITE 集合 |
| 列级重叠 | `schema-refs` + `field-expression-nodes` 输出列 |
| 形态分类 | `relation-nodes` + 表达式特征 → 镜像 / 宽表 / 报表（§4 场景 B 已验证） |

| 缺口 | 说明 |
| --- | --- |
| 查询性能 | 全库扫 bundle 约 2 分钟；正式需 SQLite 装载 |
| 业务裁决 | 只能输出**冗余候选**；保留哪张表由人定 |

**判断**：对架构要求最低；**应作为第一个落地的消费端**（与 V1 名义本金族并行）。

#### V3：乱加工红牌

| 规则 | Facts 依据 | 状态 |
| --- | --- | --- |
| 同名异源 | 同 `output_name`，`input_fields` 物理源不同 | 可自动 |
| 名实不符 | 列名与表达式关键词启发式（如 `absl` vs `dyna`） | 可自动（启发式） |
| 同表达式不同名 | `expression_text` 归一化比对 | 可自动 |
| 解析不全 | `input_dependency_status = PARTIAL` | 可自动 |
| 窗口分区不一致 | `over(... partition by ...)` 跨表字符串对比 | 待写规则 |
| 完整 filter 文本 | `predicate_display` 可能截断 | 需回 `predicate_tree` 或 SQL |

**判断**：与 V1 共用族谱分桶（场景 C）；红牌为增量规则层。候选须人核实，不能自动定性为 bug。

### 2.3 架构刻意不承诺的能力

以下**不是缺陷**，实现 V1–V3 时不应作为验收项：

1. **全自动归并**：冲突桶（如 `dyna_nom_prin` 五源同名）必须人裁定。
2. **业务命名**：「销售收入」「合约生命周期」等靠 DDL、Horae 任务名、人。
3. **调度图当数据图**：Horae 8 万任务不进 WRITE/READ 图；V1–V3 不依赖 relation 闭包。
4. **Oracle Titans 库内**：Hive 上 `titans_dm` 为源端点（`SOURCE_ENDPOINT_BOUNDARY`），不往 Oracle 伪造写者。
5. **行级指标目录**：`dm_index_n.index_val` 真实口径由 `index_id` 决定，需单独立项（见 `execution-plan-asset-graph.md`）。

### 2.4 真正缺什么（工程清单，非改架构）

```text
已有：Facts、Task-local Projection、Union continuation index、Impact Query 实现
待建：① 消费端三件套（发现脚本 → SQLite → CSV / 登记表）
      ② pdata / odata 写者 Facts 覆盖（跑批）
      ③ dm_otc_n 写者补全
      ④ DDL 注释拼接（锦上添花，不阻塞 v0）
```

对应仓库路径（实现 §1 时直接复用）：

| 能力 | 路径 |
| --- | --- |
| 字段边索引 / Impact Query | `scripts/project-graph/field-evidence-v1/` |
| 跨任务接续 | `scripts/project-graph/task-local/`、`union-continuation-index` |
| 多跳 / 源端点边界 | `scripts/reconcile/consumer/multi-hop/`、`terminal-table-config.ts` |
| 写者目录（规划） | `docs/execution-plan-writer-catalog.md` |

### 2.5 推荐验证路径

1. **先做 V2 冗余清单 + V1 名义本金族**（titans 锚点）：一周内有可审 CSV。
2. 人审：是否出现未知冲突 / 冗余对 / 红牌。
3. 审过再铺 pdata 写者 Facts，升 V1 全链；未过则收窄范围，不先跑 400 写者。

## 3. 验证用的数据

- Facts 注册表 `sql-static-lineage-data/field-facts/registry/tasks/`：6 501 份 bundle，
  其中 4 247 份写 dm_index_n，**81 份写 dm_otc_n**（本文分析时取到 68 份）。
- dm_otc_n 的 150 张上游表中，只有 7 张的写者在注册表里有 Facts，且全是 dm_index_n 维表。
  **pdata / odata 层写者的 Facts 目前为零**，这是所有跨层场景的共同缺口。
- 每份 bundle 含 `dataset-io`、`schema-refs`、`relation-nodes`、`field-expression-nodes`
  等；一份典型 bundle（118141，92 列、9 张上游）约几百 KB。

## 4. 技术能力场景（支撑 §1 的机器层）

以下 A–D 为讨论中验证过的**能力切片**，供实现 §1 时对照；不是直接对外的业务承诺名称。

### 场景 A：纵向 —— 一张表的口径说明书

**要回答的问题**：dm_otc_n.X 每一列从哪来、怎么算、被什么过滤、一行是什么粒度。

**已验证**：只读 118141 的 Facts（不看 SQL），写出了 `dm_otc_n.otc_sale_daily_rpt`
的完整口径：行粒度（合同 × 计提日，由 join 条件只含 `agt_id` + 窗口 `order by det.busi_date`
推出）、三层过滤、五张系数表的覆盖优先级（合同级 `coalesce` 类型级）、核心指标
`Curr_Prvs_Sales_Income` 的 8 条分支、二次调整（金仕达分摊 / 期权保底）、分摊拆分。

**Facts 已提供**：输出列 → 输入物理列（含 `*` 展开）、表达式原文、filter / join 条件、
聚合与窗口、`input_dependency_status`（PHYSICAL / PARTIAL / NO_PHYSICAL_INPUT）。

**Facts 不提供、需拼接**：

| 缺口 | 来源 |
| --- | --- |
| 列的业务定义（DDL 注释） | Table Pack |
| 上游 pdata 表是谁写的、pdata 列再往上从哪来 | 写者目录 + 上游任务 Facts + continuation index |
| 码值含义（如 `Inr_Org_Id = '8846'`、`grp_id = '04'`） | 码值表 / 人 |
| 叙述性文字 | LLM 基于渲染结果生成 |

**产出形态**：每张表一份，按列一行：DDL 注释 ｜ 来源表.列（CONFIRMED / 候选 / 未知）｜
表达式原文 ｜ 作用在该列上的过滤与 JOIN ｜ 粒度警告 ｜ 写任务与分区。结构部分机械生成，
叙述交给 LLM。

**已知的 Facts 缺陷**（本次发现）：`relation-nodes` 的 `predicate_display` 会被截断
（`Book_Bel_Dept != 'OT…'`），完整谓词要回 `predicate_tree` 或 SQL。

### 场景 B：横向 —— dm_otc_n 主要在做什么（业务全貌重建）

**要回答的问题**：这批表怎么分群、每群骨干上游是什么、源系统是谁、复杂度在哪、公共维度有哪些。

**已验证**（68 份 Facts，5 秒，未读 SQL）：

- 加工形态：搬运/镜像 23 张（`ctp_asp_*` 7 张、`ref_instrument`、`trd_transfer`、`t_report`
  等，只读一张表、无分支/聚合/窗口）；汇总/报表 16 张；宽表拼接 16 张；轻加工 18 张。
  **三分之一的 dm_otc_n 不是集市加工而是镜像**，很可能是为推送给下游应用而落的表。
- 报表集中在两个主题：销售收入 / 激励分摊（`otc_sale_daily_rpt`、`otc_sale_para`、
  `otc_inr_sale_*`、`otc_acs_cust_mng_rpt`，分支数 14–38，全库最复杂）；客户准入
  （`otc_cust_access_status(_org)`、`goat_ref_counter_party`，上游 BPM 流程表）。
- 宽表围着合约生命周期（`d_v_equity_trs_*`、`otc_comp_dura_chg_evt`、`opt_comp_*`），
  `src_tbl` 字面量全指向 `ODATA_N_TIT`。源系统分布：TIT 12 张、RCC 7、CRM 5、OIS 5、OAS 3、BPM 2。
- 公共维度：`t98_org_brch_div_info`（10 张表读）、`ref_cd_cvt_map`（7）、
  `t98_org_emp_base_info`（6）、`t02_tit_scr_base_info`（6）。
- `src_tbl = 'ODATA_N_XXX.YYY'` 字面量 + `Del_Flag = '0'` 是 pdata 参数表的通用形态，
  说明这些 pdata 表是源系统多张表按 `src_tbl` 分区共写。

**边界**：血缘给的是分群证据，**不给名字**。"销售激励""客户准入""合约生命周期"这些
标签来自表名和 `src_tbl` 名的推断，正式命名要接 DDL 注释和 Horae 任务名/主题，由 LLM 拼。

**产出形态**：一页地图：群 → 表清单 → 骨干上游 → 源系统 → 复杂度 → 公共维度。

### 场景 C：横向 —— 指标口径族谱（口径关系网络发现与治理）

**要回答的问题**：同一个概念（如"名义本金"）在全库有多少个字段、哪些同源、哪些同义、
哪些派生、哪些同名不同源或疑似错误。

**已验证**（68 份 Facts，匹配 `nom_prin|notional`）：160 个输出列、20 张表、约 50 个名字。
四类关系都有证据：

| 关系 | 判定依据 | 实例 |
| --- | --- | --- |
| 同源 | 多个输出列绑到同一物理列 | `sale_adtnl_det.dyna_nom_prin` → 11 列；`sale_info.init_nom_prin` → 10 列 |
| 同义 | 不同名字绑到同一物理列 | `collateral_notional = t03_otc_opt_comp_info.absl_nom_prin`；`initial_notional = init_nom_prin`；`dynamic_notional_org = ori_crrd_dyna_nom_prin`；`notional_before = adj_frnt_nom_prin` |
| 派生 | 表达式非直通 | `Init_Nom_Prin_Main/Intro` 按有无引入人 1/0 或 0.4/0.6 拆；`Absl_Nom_Prin = if(grp_id='01', Dyna_Nom_Prin, 0)`；`Accum_*` 合同存续期窗口累计 |
| 冲突 / 疑似 | 同名不同源、同名不同粒度、表达式雷同 | 见下 |

冲突 / 疑似清单（待人工裁定）：

- `dyna_nom_prin` 在 8 张表同名，物理来源有 5 个（`sale_adtnl_det`、`sale_info`、
  `swap_comp_hold_info`、`book_hold_sum`、`opt_comp_info`）。
- `otc_sale_daily_rpt.accum_absl_nom_prin` 的表达式与 `accum_dyna_nom_prin` 一字不差，
  累计的是 `det.Dyna_Nom_Prin` 而非 `Absl_Nom_Prin`。**疑似 bug。**
- `otc_inr_sale_daily_rpt.accum_dyna_nom_prin` 窗口按 `agt_id` 分区，
  `otc_sale_daily_rpt` 同名列按 `agt_id, contr_type_cd` 分区。同名不同粒度。
- `init_nom_prin` 在 `otc_inr_sale_daily_rpt` 取自 `sale_adtnl_det`，
  在 `otc_sale_daily_rpt` 取自 `sale_info`。

**边界**："同义""冲突"的最后一步是判断不是计算。机器给可核对的候选（同名不同源、
不同名同源、表达式相同），标签由人或 LLM 贴；"标准口径与实体建议"永远是人拍板。

**产出形态**：口径族谱、口径差异矩阵、归并候选清单、疑似冲突清单。

### 场景 D：正向穿透 —— 一个源字段流向了哪里、最终以什么形式被消费

**要回答的问题**：`ODATA_N_TIT.D_REF_TRS_LEG.notional` 这类源列，经 odata → pdata → dm，
最终落到哪些真正的消费终点（推送到应用库的哪张表哪列、哪个 DSP 接口、哪张报表），
沿途是原值、派生还是聚合。

**架构对应**：Field Evidence Phase 2 的 Impact Query，方向为正向。

**已验证的一跳**：`pdata_n.t98_sb_otc_swap_comp_info.ori_crrd_dyna_nom_prin` →
6 个 dm_otc_n 列（5 个直通、1 个改名 `dynamic_notional_org`）。

**三个前置条件**：

1. **覆盖**：路径上每一跳都要有 Facts。目前 pdata / odata 写者一份没有，链在 odata → pdata 断。
   补的范围是 otc 闭包内 pdata / odata 写者，几百个任务。
2. **终点证据**：Facts 追到的最后一步是最后一次写 Hive 表；真正终点在 SQL 之外——
   推送任务配置（dm → `titans_tradeflow.*` / `manage.*` 等）、DSP 接口血缘、报表/宽表平台读表。
   需把它们作为终点节点接到 Facts 的最后一次 WRITE 上（`scripts/reconcile/consumer/multi-hop/terminal-table-config.ts` 是这个方向）。
3. **状态**：直通 = CONFIRMED；派生 = DERIVED（带表达式）；多写者表的读 = 候选，靠分区匹配
   升级。实例：dm_index_n `hold_index` 有 73 个写者、125 个读者，这就是 S1 在真实数据里的样子。

**产出形态**：源列 → 终点列表，按层收口、按形式（原值 / 派生 / 聚合）分组，只列终点不列
中间任务，每条带状态。核心列 fan-out 可能上百，但一页可看完。

## 5. 诚实的边界（防止再次自嗨）

- **穿透只在层间清晰**：dm → pdata → odata → 应用库是三跳，每跳有层边界收口；
  穿进 8 万调度里不会清晰。禁 TASK→TASK 数据边正是为了保住这个性质。
- **单表说明书不需要 Facts**：LLM + SQL + DDL + 写者目录三天能出 380 份。Facts 在这个
  场景的边际价值只有 `*` 展开、别名到物理列的绑定、PARTIAL 标记、以及与 B / C / D 共用底料。
- **命名和裁定靠人**：分群、同源、派生、疑似是计算结果；群叫什么、哪个是标准口径、
  疑似是不是 bug，是人的判断。
- **PARTIAL 是真信号**：参数表在 SQL 里用别名（`Spread_Calculation`、`BASE_AWARD_RATE`、
  `Additional_Reward`）而物理列名不同（`sprd_calc_type`、`base_yield`、`adtnl_rwd`）时，
  Facts 标 PARTIAL。从 SQL 读的话 LLM 会猜，猜错看不出来。

## 6. 底料与增量（§1 + §4 共用）

```
                      Facts   写者目录   DDL 注释   continuation index   终点证据   SQLite
V1 口径归并            ✓        ✓          ✓            ✓（v1）           （v2）      ✓
V2 冗余审计            ✓                            　                              ✓
V3 乱加工红牌          ✓        ✓          ✓（核实）   　                              ✓
A 说明书               ✓        ✓          ✓            ✓
B 全貌                 ✓                                             　              ✓
C 族谱分桶             ✓        ✓                       ✓                            ✓
D 正向穿透             ✓（全路径） ✓                       ✓                 ✓         ✓
```

## 7. 建议实施顺序（对齐 §1）

1. **SQLite 装载 + 发现脚本**：Facts → 列级边 / 表级 I/O；一次扫描出 V1–V3 三份清单草稿。
2. **v0 试点**：TIT 源宽表群 + 名义本金种子；人工审一轮登记表与冗余/红牌。
3. **补写者 Facts**：dm_otc_n 余量 + pdata/odata 写者，把 V1 链补全到 v1。
4. **接 DDL 注释**：V1 标准侧展示名、V3 核实时的列定义。
5. **（可选）全貌五页 + 场景 A 单表说明书**：onboarding，非 V1–V3 阻塞项。
6. **（v2）终点证据**：推送 / DSP → 场景 D，回答「最终谁消费」。

第 1–2 步不扩上游设计；第 3 步是覆盖体力活。

## 8. 临时脚本逻辑（未入仓，§7 第 1 步雏形）

均为 Node 单文件，读 `registry/tasks/<id>/bundle/*.jsonl` 或 `*.jsonl.gz`：

- **说明书素材**：按 `relation_id` 分组 `field-expression-nodes`，取最外层 `root.project` 的
  `output_name / expression_text / input_fields / input_dependency_status`；从 `relation-nodes`
  取 `predicate_display`（filter）、`condition_display`（join）、`group_by / measures`（aggregate）。
- **业务全貌**：每个 dm_otc_n 写者统计 READ 数、输出列数、非 `STAR_EXPANSION` 表达式数、
  含 `case|if(` 的分支数、`group_by` 数、含 `over(` 的窗口数；正则抓 `src_tbl = '...'` 字面量；
  按形态分四类；统计被 ≥2 张表共读的上游。
- **口径族谱（V1 / C）**：按 `input_fields` 物理列归并；按输出名列出多源（冲突）；
  非直通表达式标派生；`titans_dm` 列作族锚点。
- **冗余审计（V2）**：表级 READ 集合 Jaccard、输出列重叠、镜像/宽表形态分类；
  titans 锚点扇出计数。
- **红牌（V3）**：同名异源、列名与表达式关键词不一致、同表达式不同输出名、
  窗口 `partition by` 字符串跨表对比。

bundle 读取须同时支持 `.jsonl` 与 `.jsonl.gz`（oracle2hive 等多为未压缩 `.jsonl`）。
