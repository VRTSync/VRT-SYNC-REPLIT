# Import upload steps — master bill and seasonal contract

Both admin imports live on **Admin → Data Import** (`/admin#imports/seed`) and run
the same three-step sequence: **Upload → Preview → Commit**. Nothing is written
until Commit, and every commit is recorded as a row in `import_batches` with an
Undo SQL script shown on the result screen.

Both importers validate their source data against the same fixed pilot
allowlist of eleven branch codes (`KNOWN_PNC_CODES`):

`FB01 FB02 FB08 FB15 FB16 FB1B FB36 FB45 FB4F FB5F FB65`

---

## The acknowledgement step (both importers)

A pilot code with **no matching community row** is not a hard error — a branch
leaving the portfolio is a normal event — but it is never skipped silently
either. The preview lists each unmatched code with its own checkbox, and
**Commit stays disabled until every one is ticked**. There is deliberately no
"skip all" button: each exclusion is a separate decision.

What acknowledgement does *not* do is loosen any other guard. Ambiguous codes
(one code matching several communities), codes spanning more than one
organisation, and layout-assertion failures all remain hard blocks that no
checkbox can lift.

On Commit, the server re-derives community resolution inside its own
transaction and rejects the request if:

- an acknowledged code is not genuinely unmatched server-side, or
- a server-unmatched code was not acknowledged, or
- resolved + acknowledged does not cover the full eleven-code pilot list.

The acknowledged codes are written to `import_batches.acknowledged_codes` and
echoed in the post-commit summary, so a later reader can tell a deliberate
"10 of 11" from a branch that quietly went missing.

**Current standing decision (2026-08-20):** `FB45 — 88th and Wadsworth` is not
in the portfolio. Both imports are run with FB45 acknowledged and excluded.

---

## Master bill upload

1. **Upload** — choose the billing period (`master_bill_2026_05`, `_06`, `_07`)
   and drop in the matching High Plains `.xlsx` workbook. It must contain a
   "Service Detail" sheet. Parse runs the preview automatically.
2. **Preview** — check the PNC code → community mapping, the per-branch counts,
   the date-clamped rows and the skipped rows.
   - Tick the checkbox for each unmatched code (today: **FB45**). Here the
     acknowledgement **does** change the figures: the code's rows and dollar
     amount are subtracted from the invoice, completion, contract and total
     amount cards, and added to the skipped-row count, so the numbers on screen
     always match what will actually be written.
3. **Commit** — confirm the dialog, which names the acknowledged exclusions.
   The result screen shows inserted/skipped counts, the unified skipped-row
   table (parse-stage skips plus acknowledged skips), the acknowledged codes,
   the batch id and the Undo SQL. Copy the Undo SQL before leaving the page.

Re-committing the same workbook inserts nothing: invoices are idempotent on
(invoice number, reference number, community, completion date) and tasks on
their import fingerprint.

## Seasonal contract upload

1. **Upload** — drop in `Contract Task List - VRT.xlsx`. Fixed layout: exactly
   8 columns and 18 rows, every Start Date in 2026, every End Date after its
   Start Date. No column mapping. The programme is expanded across the pilot
   communities that resolve.
2. **Preview** — check the pilot community mapping and the projected counts.
   - Tick the checkbox for each unmatched pilot community (today:
     **FB45 — 88th and Wadsworth — not in this organisation — proceed without
     it**).
   - Acknowledgement here **only lifts the block — it changes no number.** The
     projections are computed from the communities that resolved, so they are
     already correct for a short portfolio. A scope line under the totals says
     so: *Projected for 10 of 11 pilot locations — FB45 excluded.*
3. **Commit** — confirm the dialog, which repeats the exclusion note. The
   result screen shows the created schedules, inserted/skipped visits and
   tasks, the completions, the acknowledged exclusions ("Imported 10 of 11
   pilot communities"), the batch id and the Undo SQL.

Projected and written figures for the current file at 10 branches:

| Figure | Value | Per branch |
|---|---|---|
| Schedules | 30 | 3 |
| Total visits | 580 | 58 |
| Completed visits | 400 | 40 |
| Scheduled visits | 180 | 18 |
| Tasks | 150 | 15 |
| Completions | 80 | 8 |

Every generated `service_date` is a Wednesday inside the season window
2026-04-01 … 2026-10-31. Re-committing the same file adds nothing: schedules
are keyed by their `contract_schedule:{title}` note, visits by
(schedule, service date) and tasks by their schedule instance key.

---

## Resulting portfolio figures (FB45 excluded from both imports)

| Figure | Value |
|---|---|
| Invoices | 138 |
| Invoice total | $52,695.90 |
| Import completions (master bill) | 109 |
| Seasonal records | 730 |
| **Services Logged** | **589** |

Services Logged breaks down as 400 completed seasonal visits + 80 seasonal
one-time completions + 109 master-bill import completions.
