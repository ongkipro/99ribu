Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, this is the consultation result, in English as the prompt asked. I made no writes, ran no tests and touched no DB. I skipped the plan file too, since your prompt forbade plan files.

# S26 field-retention debug consultation (r1)

**Runtime/model:** Claude Code, `claude-opus-5-5`. **Tree:** HEAD `8b17eee` (matches).

## Sources read (sha256)
- `src/components/storefront/checkout-forms.tsx`: `bf4962e1…0fedbf` (read twice, unchanged)
- `src/components/storefront/checkout-frame.tsx`: `d88ded8d…773c47`
- `src/components/storefront/checkout-exit.tsx`: `08bbf0c6…a5dea4`
- `src/app/(storefront)/checkout/page.tsx`: `0ab00e20…e939e5`
- `src/app/(storefront)/checkout/actions.ts`: `0e79aabe…ee1e`
- `tests/browser/storefront-checkout.test.ts`: two versions. It was `40104c65…f9937` (297 lines, with `GEOMETRY_TRACE`) and became `3a5dd20e…d424` (305 lines) while I was reading. In the new version the trace is gone and there's a new test at line 185: "contact typed before delayed hydration survives the first enhanced edit and autosave". My analysis covers both versions.
- Raw evidence: the red-r1, green-r1 and diagnostic-r1 files. I did not open the build manifest.
- Installed versions: React and react-dom 19.3.1, Next 16.4.1. I checked React's behaviour in `node_modules/react-dom/cjs/react-dom-client.development.js`.

## What is demonstrated vs. hypothesis

**Demonstrated by the evidence:** the 320px run lost the name value (`""`) somewhere after `contact()`. The test's first read of that value is the 768px assertion, so the evidence doesn't show *when* it was lost. The diagnostic run with five reads passed. Neither run proves a cause.

**Unlikely culprits (from reading the code):**
- **The 768px resize:** the only viewport-driven React logic is in `Summary`, at `checkout-forms.tsx:86`. It watches `(min-width: 1024px)`, and going from 320 to 768 doesn't cross that.
- **The summary toggle:** it's a native `<details>` and touches no React state.
- **The screenshots and `addStyleTag`:** neither changes React state.

The resize step is just where the loss was first observed.

### H1 (strong): text typed before hydration is wiped on the next re-render, then autosaved blank
How React 19.3.1 behaves (from installed source):
- During hydration, `initInput(..., isHydrating=true)` never writes `element.value`. So text Playwright typed before hydration stays in the DOM, and `track(element)` records it as the last-seen value.
- Nothing replays it into state: the build has no `queueChangeEvent` or similar. `onChange` never fires for those keystrokes, so `draft` state stays at the server's `initial` value (empty).
- On the next commit of `CheckoutController`, the controlled-field update writes `element.value = ""` because the DOM differs from props. `updateInput` does this for inputs and `updateTextarea` for textareas, and `select` and radios get the same controlled reset.

Paths that trigger that re-render in this form:
- `setField` / `setDraft` from any later edit (`:118`)
- `draftSave.changed` → `setFeedback('Menyimpan draf…')` (`:48`)
- the mount effect at `:111-117`

So if hydration finishes partway through `contact()`, every field filled earlier gets blanked by the next field's `onChange`. Filling name first and phone second matches what we saw: only name was empty.

**Data-loss part:** the autosave timer (`:49`, 400 ms) then reads `new FormData(form.current)` *after* the reset, so it stores the blanks on the server.

**Why it's intermittent:** `page.goto` waits for the `load` event, not hydration. The test file has no hydration-ready check. The diagnostic edits only ran *after* `contact()`, so they didn't change this timing. Its PASS just means hydration happened to finish before the first fill.

### H2 (weaker, not demonstrated): a race with the mount effect
The `:111` effect runs `setDraft(state.intent.draft)` on mount. If a typing event lands after the hydration commit but before passive effects flush, the effect's update is queued after the user's update and wins when the queue is replayed. That blanks the field. I haven't confirmed React 19.3's exact flush order for this, so treat H2 as a plausible secondary window, not a finding.

## Minimal faithful reproduction
The new test at line 185 already reproduces H1:
1. Delay `**/_next/static/**/*.js`.
2. `goto` with `waitUntil:'commit'`, then run `contact()` before hydration.
3. Release the scripts and wait for the `observeCheckoutEntry` Server Action POST as the hydration signal.
4. Make one edit after hydration and wait for `Draf tersimpan.`.
5. Check all retained values, plus zero quotes and zero orders.

On current app source I expect it to fail at the name assertion (static prediction, not run).

**One assertion to add (stronger, not weaker):** after `Draf tersimpan.`, reload the page (or read the stored draft) and assert the typed values survived. Today it only checks the DOM, so it doesn't prove the server-side data-loss path described above.

## Smallest justified fix (proposal, not applied)
In `CheckoutController`, on the **first** run only, read the values already in the DOM and adopt them before anything else re-renders:
- Use `useLayoutEffect` (or change the mount branch of `:111`) so it runs in the hydration commit, before any event can interleave. That also closes H2.
- Read `new FormData(form.current)`, keeping only the `CheckoutDraft` keys and `query`. If `payment_method` is missing (no radio checked), keep the state value.
- If any value differs from `state.intent.draft`, call `setDraft({...state.intent.draft, ...typed})`. Also call `setDirty(true)` unless `buyer_note` is the only change, and call `draftSave.changed()` so autosave stores the typed values.
- Later runs keep today's reset to `state.intent.draft` after an action reply.

That's one effect in one file: no new abstraction or dependency, no sleep, no retry. Switching the fields to uncontrolled `defaultValue` would be a much bigger change because it breaks the reset after action replies, so I don't recommend it.

## Limits
- I ran nothing, so H1 is inferred from code and React source, not observed.
- I didn't read `modules/storefront/checkout*.ts` beyond the cookie check in `browser.ts`, so I haven't ruled out a Server Action refresh path. Nothing in the files I read keys or remounts the controller, though.
- The test file changed during the consultation. The fix above needs its own red-to-green run and review before anyone treats it as accepted.
