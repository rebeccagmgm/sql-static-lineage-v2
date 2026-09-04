INSERT OVERWRITE TABLE mart.target
SELECT source_a.amount AS amount
FROM mart.source_a AS source_a
WHERE source_a.keep_a = 1;

INSERT OVERWRITE TABLE mart.target
SELECT source_b.amount AS amount
FROM mart.source_b AS source_b
WHERE source_b.keep_b = 1;
