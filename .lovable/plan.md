## Why editing fails as admin

When you enter admin mode and click any shift cell, the app crashes instead of showing the dropdown. Two bugs cause it:

1. **Shift dropdown crash** — the "Clear" option in the shift picker uses an empty string as its value. Radix UI's Select forbids empty-string item values and throws:
   > A `<Select.Item />` must have a value prop that is not an empty string.
   This breaks the entire page the moment a shift Select renders, so no edits go through.

2. **Hydration mismatch on week dates** — the current week is computed from `new Date()` at render time, so the server prints one date (e.g. `27/6`) and the client prints another (e.g. `26/6`). React then throws away the client tree and re-mounts, which also contributes to edits feeling like they "don't stick".

## Fix

In `src/components/RosterApp.tsx`:

- Replace the empty-string "Clear" shift code with a real sentinel value (`"CLEAR"`) in `SHIFT_OPTIONS`. In the Select's `onValueChange`, map `"CLEAR"` back to `""` before saving. Use a non-empty placeholder value (e.g. `"NONE"`) for cells with no shift assigned so `<Select value>` is never `""`.
- Defer the "today" calculation until after mount: initialize `state` with a stable placeholder week, then set the real current week inside a `useEffect` on the client. This removes the SSR/CSR date mismatch.
- Keep everything else (admin password, categories, table, arrivals/departures) unchanged.

No other files need changes.