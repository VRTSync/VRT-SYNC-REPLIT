# P2 backend performance verification

## Scope and implementation

Confirmed all seven named hotspots against the current routes and storage functions.
Migration number 0025 was unused before editing. Read-only production index inspection
confirmed that none of the five requested leading-column indexes existed.
The existing asset-properties composite index was left unchanged.

- Full property reads use deduplicated, sequential chunks of at most 1,000 asset IDs,
  return an empty map without querying for empty input, and retain property-key order.
- Completeness, incomplete assets, and layer summaries load the catalogue once and
  calculate missing keys by **key presence**, not nonempty values. Catalogue required-key
  order and existing asset ordering remain unchanged, including inactive catalogue types.
- Work history joins links, completions, tasks, and completing users once per
  1,000 requested asset IDs. Attachment reads are also chunked at 1,000 IDs.
  Duplicate links do not duplicate completions. The original manager-company and
  membership predicate, descending completion dates, per-asset slice semantics,
  and omission of assets with no history are preserved. The single-asset helper remains.
- The seven top-level admin-summary counts use **Promise.all**. The existing
  asset/property batching is unchanged. Layer counts use one grouped query and are
  mapped over the original layer sequence with zeros for empty layers.
  The grouped query filters by selected layer IDs rather than asset community:
  the old loop counted legacy cross-community asset references to those layers,
  so adding a community filter would have changed results.
- The feature-count cache is nullable and internal. Existing layer responses do not
  acquire an extra field. Summary metadata uses a SQL CASE projection that transfers
  GeoJSON only when the cache is NULL; the original parse fallback remains.
- Create, upload, explicit-ID replacement, key replacement, merge, irrigation
  controller/zone writes, edits, and map-creator pin creation/appending maintain
  the cache. Routes reuse already parsed feature arrays; storage also computes a
  count for other direct callers. Repository-wide write search found only the two
  centralized storage writers.
- No policy, route-name, portal, mobile, or CSP changes were made.

## Migration evidence

`0025_performance_indexes.sql` is registered in the journal with a generated
Drizzle snapshot chained to 0024. Snapshot equivalence tests confirm exactly:

1. `assets_map_layer_idx` on `assets.map_layer_id`
2. `community_members_user_idx` on `community_members.user_id`
3. `task_links_task_idx` on `task_links.task_id`
4. `task_links_asset_idx` on `task_links.asset_id`
5. `task_completions_task_idx` on `task_completions.task_id`
6. Nullable integer `map_layers.feature_count`

DDL uses IF NOT EXISTS. The backfill only visits NULL counts, catches malformed
JSON/data exceptions per row, and only counts JSON feature arrays. It does not
overwrite an existing count. It works when the column already exists from the
publish schema diff.

Fixture migration notices:

```text
P2 counts: layers backfilled=2, layers left null=5
P2 counts: layers backfilled=0, layers left null=5
```

Actual **development** migration rerun, November 24, 2026:

```text
P2 counts: layers backfilled=0, layers left null=0
```

PostgreSQL NOTICE events are explicitly forwarded to the API logger for the P2
count prefix; a runtime unit test verifies this. This development evidence is
**not** a deployment log or a production backfill count.

## Tests and startup

Final commands:

- `pnpm run typecheck:libs` — passed; rebuilt shared database declarations.
- `pnpm --filter @workspace/api-server run typecheck` — passed.
- `pnpm --filter @workspace/api-server test` — **1,672 passed, 0 failed,
  0 skipped**, 48 suites. Includes **15** P2 performance/metadata/logging tests.
- `git diff --check` — passed.

Fixture tests compare changed storage results against frozen pre-P2 algorithms
and exercise real route handlers with PostgreSQL transactions. They cover
multiple types, missing/empty properties, archived assets, unknown catalogue
lookups, populated/empty layers, scoped/unscoped histories, photos, duplicate
links, live manager-company changes, revoked membership, every layer write
path, optimistic conflicts, fallback parsing, migration reruns, and metadata.

Warm-catalogue query assertions (nonempty fixtures):

| Read | Up to 1,000 IDs | Larger fixture |
| --- | ---: | --- |
| Property helper | 1 | 2,001 IDs: 3 queries, 1,000/1,000/1 bindings |
| Completeness route | 2 | More than 1,000 active assets: 3 |
| Incomplete assets | 2 | More than 1,000 active assets: 3 |
| Layer asset summary | 2 | More than 1,000 active assets: 3 |
| Admin summary with community | 11 | 11 after adding 1,001 assets |
| Admin summary without community | 7 | Independent of asset count |
| Offline history snapshot | 3 | 1,001 completions: 4, including two photo batches |

An empty property-helper input does no queries. An empty community history does
one asset query. A cold catalogue adds one catalogue read, explicitly tested.

The API workflow was rebuilt/restarted once after the changes and started cleanly.
The protected `/api/ping` endpoint returned its existing unauthenticated 401 body;
the preview screenshot confirmed that response. Authenticated handlers are covered
by the fixture suite. No browser UI flow or production performance test was run.

## Production data comparisons

Read-only production database access was available. Before/after investigative
reads on November 24, 2026 returned the same totals:

| Community | Active | Archived | Incomplete | Tasks | Pending | Completed | Layers | Members |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Miramonte Ranch | 791 | 0 | 438 | 19 | 15 | 0 | 9 | 3 |
| College Hills | 0 | 0 | 0 | 16 | 12 | 1 | 1 | 3 |

Read-only SQL also compared the original per-layer count expressions against the
replacement grouped counts on these production rows: all 9 Miramonte layers and
the College Hills layer matched. Incomplete counts use the same required-key
presence rule. Members are supplemental comparison data, not a new summary field.

These are database result-equivalence checks, **not** calls to the unpublished
new application against production. Actual old/new storage implementations are
compared using the transactional fixture suite. The development database has
Miramonte Ranch but not College Hills; no production data was copied or mutated.

## Dashboard query-plan findings

Ran EXPLAIN (ANALYZE, BUFFERS) for all six existing dashboard aggregate statements
through the database skill's read-only production access:

| Aggregate | Execution time |
| --- | ---: |
| Totals | 178.925 ms |
| Exceptions | 23.447 ms |
| Eight-week trend | 1.182 ms |
| Photo proof | 1.274 ms |
| Business | 1.561 ms |
| HOA user additions | 1.538 ms |

The slowest observed statement was totals. Its initial full-table active-asset
scan read 135 pages and took approximately 159 ms, consistent with cold I/O.
These are whole-table counts, so none of the five requested filter indexes
justifies changing this statement. The exceptions statement has correlated
community subplans but executed in about 23 ms on this data. No one-second SQL
statement was reproduced; no dashboard rewrite or extra index was added.
These plan times are not end-to-end HTTP timings.

## Required release checks still pending

The current published URL was obtained from deployment metadata:
`https://vrt-sync-mobile.replit.app`. This branch has **not** been published.

After merge:

1. Review the actual Publish preview with the user. Expect only the five indexes
   and nullable integer column above. Do not approve drops, unrelated changes,
   or overwrite-data options. The source snapshot comparison is not a substitute
   for reviewing that actual preview.
2. Publishing is the user's action. No automatic publication was performed.
3. After the user publishes, capture the real deployment's `P2 counts:` line.
   Use deployment/SRE guidance to identify the correct new revision's logs.
4. In an authenticated production browser, measure Miramonte Ranch:
   completeness **under 1,500 ms**, overview summary **under 600 ms**,
   Map Layers fully rendered **under 3 seconds**.
5. Recheck the two communities' numbers; upload, irrigation upload, edit and delete;
   and an account-manager offline pack/history. Use disposable approved data and
   preserve existing customer data.

The brief's 27,059 ms / 1,575 ms / roughly 10-second figures are historical
observations, not measurements made during this work. Production targets,
post-publish regression checks, the actual Publish preview, and the production
P2 deployment notice remain unverified until merge and user-triggered publishing.
