# 86840 Gold Case

This is the first real L1 vertical case. It intentionally contains no SQL, Schema, generated facts or fabricated fixture yet.

Required input before implementation acceptance:

1. final SQL snapshot and declared dialect;
2. complete Schema/View dependency closure used by parsing, resolution, Star expansion and target binding;
3. snapshot hashes and acquisition provenance;
4. explicit target/Write scope for 86840.

Execution order is `freeze inputs -> analyze -> publish Contract 2.0 Core Facts -> validate -> inspect`. A Reader card made from the old 1.3.0 bundle is only a legacy readability reference and cannot close this Gold Case.
