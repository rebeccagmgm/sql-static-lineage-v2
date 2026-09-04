1、"E:\02_area\股衍数据-数据cookbook\sql-static-lineage\scripts\query\producer-index-query.ts" 消费-资产索引的
2、"E:\02_area\股衍数据-数据cookbook\sql-static-lineage\scripts\query\current-task-bundle.ts" 服务于 【machine-facts】
3、"E:\02_area\股衍数据-数据cookbook\sql-static-lineage\scripts\query\task-inspection.ts" 服务于 【machine-facts】


Producer Index 查询链：
producer-index → producer-index-query

Machine Facts 消费链：
machine-facts → current-task-bundle → task-inspection