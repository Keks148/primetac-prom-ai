PrimeTac AUTO v3.4.19 PROBE START FIX

Why this build exists
The one-family test could redirect to the status page before the background worker had switched variantProbeState.running to true. The page then rendered IDLE without a meta refresh and appeared permanently stuck with no selected family.

Fix
The worker is invoked directly in the POST handler. Because async functions execute synchronously to their first await, the state is changed to PREPARING/running before the browser follows the redirect. The status page then keeps refreshing while the probe selects a family, submits the tiny YML and verifies the result.

Safety
- exact supplier XML group_id family only
- maximum 20 positions in the test family
- no bulk variant restoration
- only_update=true
- prices, stock, photos and descriptions are not intentionally changed
