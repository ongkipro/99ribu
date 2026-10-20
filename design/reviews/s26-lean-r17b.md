# S26 r17b correction — lean diff review

Author: codex-root (builder; lean review only)
Scope: six changed source/test files relative to `/tmp/99ribu-s26-r17b-nogo-build27`; exact current fingerprints below. This is not independent engineering, visual or final acceptance.

Traced checkoutAllocationChoices to the authorized native read and runtime regression; AllocationChoices serves both the current option and native disclosure. Grouping retains native IDs and does not rewrite quote authority. Server previousTotal replaces the client-only history ref. CSS checked-state warnings serve JS and no-JS without another pricing implementation. Existing formatter, parser, service controls and harness are reused; no dependency, schema, config or future-use abstraction added.

Lean already. Ship.

```json
{
  "src/modules/storefront/checkout.ts": "9e4084c7c115bfc52e8a5e829ef282fb99f2b76a4a4d61a375697f2832ed3d4b",
  "src/components/storefront/checkout-forms.tsx": "56b8b36aad96ebd13aa07723f2afaac0a959a3321566025d8ff09663e0c3e974",
  "src/components/storefront/checkout-frame.tsx": "eea4a7135758c03b4265e210e23739940327bdbf781c249d0cf5739103cdf0f1",
  "src/app/globals.css": "eaa6694b0eecdac3a32ee06d624adb29d7d7c067bfc3d73377dd635bd07289c1",
  "tests/integration/storefront-checkout-runtime.test.ts": "1186684a69dcc3abd94529b80ba02ab9fcd9a6c9ecc9ceae142a57cfd43af02e",
  "tests/browser/storefront-checkout.test.ts": "ff3ba4d9613e38e3d8f860d59fe0802ba3a7a21d443c873024876a708fe7535f"
}
```

## Current-source recheck

Reviewed the final compact-header/:target CSS and all allocation-radio callers. Enter tests open the same native disclosure a buyer uses; no force click, timeout relaxation or assertion removal. Compact header omits only its redundant SVG while retaining visible labels, accessible names and existing target sizes. Help return uses native fragment state. Previous fingerprints above describe the earlier correction; the current six-source fingerprints follow.

Lean already. Ship.

```json
{
  "src/modules/storefront/checkout.ts": "9e4084c7c115bfc52e8a5e829ef282fb99f2b76a4a4d61a375697f2832ed3d4b",
  "src/components/storefront/checkout-forms.tsx": "56b8b36aad96ebd13aa07723f2afaac0a959a3321566025d8ff09663e0c3e974",
  "src/components/storefront/checkout-frame.tsx": "eea4a7135758c03b4265e210e23739940327bdbf781c249d0cf5739103cdf0f1",
  "src/app/globals.css": "24205393960207b6198ea150e900214543df918a37650e3babf00337f0173241",
  "tests/integration/storefront-checkout-runtime.test.ts": "1186684a69dcc3abd94529b80ba02ab9fcd9a6c9ecc9ceae142a57cfd43af02e",
  "tests/browser/storefront-checkout.test.ts": "03da03d1d2bd2d6c0014a21b97bc70fa7a92e0636dacda678cbfec58019db07f"
}
```
