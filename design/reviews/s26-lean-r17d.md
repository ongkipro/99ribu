# S26 final allocation refinement — lean review

Author: codex-root (builder; lean-only review).
Scope: five source/test files since actual source-r17c approval; no independent/visual/final approval.

Issued-first projection reuses selected_plan plus the other native plans; the visible key is computed once per plan. Only an alias of the issued group needs separate pending identity, so no duplicate non-issued alias group or native mutation is introduced. The nearby apply button uses the existing form action without a name, hidden payload or handler; checked-state CSS exposes one relevant secondary action. Initial native disclosure state is preserved until quote identity changes. Existing regressions exercise both submission modes, no-implicit-order/quote guards and alias grouping. No dependency, utility layer or extra price authority added.

Lean already. Ship.

```json
{
  "src/app/globals.css": "ddeff35ef1c48a093f699fc134d7bf4250c8c2715f3495a6180899167aa99315",
  "src/components/storefront/checkout-forms.tsx": "b54fa643a819697968339331f7a3dead334dde108014693da609b835327cf931",
  "src/modules/storefront/checkout.ts": "ba334e73a3e08600b213acbb930b39d779dbfde22f8f3634bf395b99754a5f36",
  "tests/browser/storefront-checkout.test.ts": "2b6362eebb50fd19bb86ff942747c74a82bc3193bfe306e197f6ee81607fbc2a",
  "tests/integration/storefront-checkout-runtime.test.ts": "16e1534a9d0f97fdeabe5e0b6e6064ea548ba1552c736a79738dbb48fd610dff"
}
```

## Disclosure correction recheck

The actual build32 diagnostic exposes a real controlled-attribute regression: reasserting the initial open boolean closes the user-opened list on rerender. Use the existing native onToggle event to mirror its actual open state into the already-needed React state. No new handler layer or test relaxation. Current form fingerprint: `b87aa2356c79af00308536b5bf496fcf8f7a7e4094184dea541e29e9dd42e072`.

Lean already. Ship.

## Verified initialization diagnosis

The follow-up observation corrects the earlier diagnosis: details was already open while the issued radio was checked, so the summary click closed it. A new quote mounts the child before the parent layout effect syncs its local allocation. Initialize the existing disclosure state from accepted action intent, mirror later native toggles, and retain the quote key. This removes dependence on transient local state without another effect or abstraction. Current form SHA `80d936760a7cc76d3d32d1b8938f85b5e00c2b90668e9d22ee568dce7d598656`; added fresh-default-collapsed browser assertions are meaningful guards.

Lean already. Ship.

## Final five-source recheck

Rechecked the final accepted-intent initialization/native toggle fix and all changed callers after actual focused3/full25/type0. No further code change proposed. Exact current fingerprints:

```json
{
  "src/app/globals.css": "ddeff35ef1c48a093f699fc134d7bf4250c8c2715f3495a6180899167aa99315",
  "src/components/storefront/checkout-forms.tsx": "80d936760a7cc76d3d32d1b8938f85b5e00c2b90668e9d22ee568dce7d598656",
  "src/modules/storefront/checkout.ts": "ba334e73a3e08600b213acbb930b39d779dbfde22f8f3634bf395b99754a5f36",
  "tests/browser/storefront-checkout.test.ts": "e06adf531ab1727f37ffd38c131c94f1b36d4c0b32c0af8db62227b0096c13bf",
  "tests/integration/storefront-checkout-runtime.test.ts": "16e1534a9d0f97fdeabe5e0b6e6064ea548ba1552c736a79738dbb48fd610dff"
}
```

Lean already. Ship.
