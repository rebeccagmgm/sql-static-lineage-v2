INSERT OVERWRITE TABLE mart.target
SELECT :runtime_amount AS amount
FROM mart.source_a AS source_a;
