# Offline city combobox — keyboard focus and screen reader contract

**Status: prototype.** This change is limited to the fictional/offline city
picker's keyboard behavior; no private catalog, real birth data, services or
astronomical calculations are required.

## Behavior

- The **search input is the only Tab stop inside the combobox**. Suggestions
  retain button click handling for pointer input but have `tabindex="-1"`.
  Listbox selection remains represented by `aria-activedescendant` on the
  input; typing and arrow navigation do not move DOM focus into the list.
- With suggestions, **ArrowDown/ArrowUp** cycle through choices, and **Enter**
  selects the active suggestion. Typing a query without an active suggestion
  must not inadvertently select the first result on Enter.
- **Tab** dismisses visible suggestions but is **not prevented**, so focus
  proceeds to the next ordinary control.
- **Escape** dismisses suggestions or pending search. When a suggestion list is
  visible the handler prevents the browser from also clearing the input value.
- **Home/End** are reserved for editing the text field; no custom interception.
- The input now explicitly names its `listbox` popup and references the
  existing translated live status with `aria-describedby`.

## Validation

Run `node --experimental-strip-types --test tests/offline-city-keyboard.test.mjs`
and `npm test` on a compatible Node 22+/24+ development checkout, followed
by `npm run build:ui` when the sibling Charts library is available.
Pure helper tests cover key mapping and invalid state; markup/source
contracts confirm that option buttons cannot steal Tab focus. These checks
are **not a replacement** for native keyboard and assistive technology QA.

Manual WebView2 checks on Windows:
1. Open Settings, type a query with several local results, press Down, Up,
   Enter; confirm only the highlighted place is selected.
2. With suggestions visible, press Tab; verify focus moves to the next
   normal control without entering the individual result buttons.
3. Reopen suggestions, press Escape; verify the query remains intact and
   the suggestions are dismissed. Check Escape during the debounce.
4. Verify Home/End move the text cursor; click suggestions with the mouse.
5. Repeat in Italian and English and with Windows screen reader / Contrast
   themes enabled, then check no regression in WebView2.

No change to Tauri commands, city database assets, persistence, identity,
authorization, cloud sync, encryption, release signing, or CPAL/NOTICE.
The selected city continues to be temporary and does not calculate a chart.
