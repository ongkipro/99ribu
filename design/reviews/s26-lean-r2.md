# S26 draft correction complexity review

Builder review before the next actual separate source review. The prior21-source surface and source-r1 failure remain required context; the correction adds the private draft helper, task-exit leaf and native regression. Nine original source/test/registry files changed. This note does not approve correctness, privacy, appearance or slice completion.

Traced every caller of read/write/clearCheckoutDraft, saveCheckoutDraft, CheckoutExit, useDraftSave and shared draft field/limit constants. The existing privateDirectory, native actor/session/cart authorization, PostgreSQL advisory locking, Node filesystem atomic replacement, existing closed FormData parser and React form lifecycle are reused. No dependency, public REST API, migration, generic cache framework, new quote or financial authority was added. Persistence, bounded input, revision fencing, unknown-intent retention and no-JavaScript task-exit behavior implement the accepted requirement and are not deletion candidates.

Resolved finding: `src/app/globals.css` retained a checkout-note rule after the static note became an editable labeled textarea. Repository-wide source/test caller search found only the rule; deleted it. Fresh build/browser proof is required after that deletion.

No further defensible complexity findings in the correction. Native chat, physical-device evidence, background physical retention, canonical visual review, design-gate and final current-union R3 remain separate gates.

After the current browser pass, the affected predecessor cart diagnostic exposed global fixture selection. The bounded test-only correction uses existing native seed/curation and one owned namespace with exact product IDs; it removes the global first-match product query. Traced its two consumers and lifecycle cleanup. All16 original cart assertions/cases remain. This required test isolation adds no application abstraction or stock reset.

The subsequent denied-autosave correction adds one local denial flag to the existing form hook and reuses its existing private recovery region. Actual competing-tab/revocation RED and current native9/browser15/cart16 prove the required behavior; no new abstraction or dependency was introduced. Current source remains24 objects (original21 plus three new source/test files).
