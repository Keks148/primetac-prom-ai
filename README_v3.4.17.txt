PrimeTac AUTO v3.4.17 VARIANT AUDIT SYNC

Fixes the zero-state race seen in v3.4.16.

After Deploy:
1. Open Variants audit and press Repeat audit once.
2. Wait until the old useful numbers return (about 1552 positions / ~287 families / ~728 savings).
3. Only then the TEST 1 FAMILY link appears.
4. Open the preview. No Prom write happens until the explicit POST button on the preview page.

The successful audit is saved to /var/data/primetac-variants-audit.json when AUTO_STATE_PATH is on /var/data, so the report survives future Deploy/restarts.
Mass restoration remains disabled.
