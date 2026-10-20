# S26 source-r17b follow-up — lean review

Author: codex-root (builder; lean-only review).
Scope: five source/test files changed since the retained source-r17b revision; no independent or visual/final approval.

The P2 fix removes a conditional duplicate branch and always retains the issued native form controls, using existing checked-state CSS to govern display. Pending native identity stays explicit in an existing grouping key; native details exposes it without a new widget. District/full selected description reuses canonical destination fields. The existing regressions retain key/step/quote/order and timeout assertions, extending the actual JS/no-JS revert path and native allocation-total/identity coverage. No package, fallback pricing layer, server default for invalid empty selections or future abstraction added.

Lean already. Ship.

```json
{
  "src/app/globals.css": "ce64d526d32813bc4c9eac6052af87f13e034c09a88cb22f2f26cb3385dadc7c",
  "src/components/storefront/checkout-forms.tsx": "5710f6501426e620f341ee2a10f974e6bee3ca2b4f514387f2a880be9809628a",
  "src/modules/storefront/checkout.ts": "b863f8ea7c950bb828ae04c13843908d9fbac253652bd795c9c341ea80cda9d7",
  "tests/browser/storefront-checkout.test.ts": "efb3d57b497c1b2f0264fa531eb24049e44fc13ddd139645f3cb111c6361e073",
  "tests/integration/storefront-checkout-runtime.test.ts": "69d5f462c48ab3ef6811db7d5d34a1d63c681ace6ac7db2ea6f88f3c9340c4cf"
}
```
