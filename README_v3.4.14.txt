PrimeTac AUTO v3.4.14 SUPPLIER GROUP_ID AUDIT

READ-ONLY audit. It does not write to Prom.

Changes:
- Preserves group_id / groupId / variation_group_id from supplier XML offers.
- Uses exact supplier offer group_id as the strongest signal for reconstructing old variation families.
- Exact XML group_id families outrank title-based, supplier-name, SKU and fuzzy candidates.
- Report shows how many supplier records contain group_id, how many exact families were recovered, their positions and estimated card savings.
- Existing v3.4.13 title/size/color/SKU audit remains as fallback.

Run: deploy, then open Variants audit. If XML feeds contain the original Prom/YML group_id, the safe savings estimate should rise sharply.
