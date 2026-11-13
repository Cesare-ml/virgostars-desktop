# Offline city picker debounce scheduler recovery

**Scope:** small, synthetic-only Angular state-machine resilience improvement. The existing `OfflineCityPickerState` already ensures the most recent lookup wins; it previously assumed that timer setup and teardown always succeeded.

## Failure handled

In unusual embedded WebView environments or injected test drivers, `set()` may throw, return no usable handle, invoke a callback synchronously, or re-enter `input()`. Previously a thrown setup could interrupt the UI event handler and leave the picker labeled "preparing search" indefinitely. A synchronously fired timer could also be reinstalled as a stale `pending` handle, masking a newer timer. A throwing timer `clear()` or search `clear()` could block input, choice or component disposal.

The debounce state now:
- displays the existing translated **unavailable** status if scheduling fails or returns a null/undefined handle; invalidates that generation so a late callback cannot execute a search;
- accepts numeric handle `0` as valid;
- ignores duplicate callbacks, does not preserve a handle that has already fired, and does not overwrite a newer request after re-entrant setup;
- contains timer and lookup invalidation errors; stale callbacks remain guarded by the sequence and destroyed flag;
- recovers on a subsequent typed input after a transient setup failure.

There is **no automatic retry** or new timer running in the background. No change to the Rust Tauri database/search contract, IPC privileges, regional/country data, astrology, assets, logging, network services, authentication, storage or license. Only synthetic `OfflinePlaceV1` fixtures are used in tests.

## Verification

```sh
node --experimental-strip-types --test tests/offline-city-picker-state.test.mjs
npm test
npm run build:ui
```

Focused cases cover setup exceptions, null/undefined handles, synchronous and duplicate callbacks, re-entrant input, broken cleanup and normal retry. A full Windows WebView2 smoke remains necessary: input at least two letters, rapidly edit/cancel, choose a result, close/reopen the inspector and verify correct status without stale results. Test status is only what is actually executed; a source review is not a compiled application or a private catalog acceptance test.
