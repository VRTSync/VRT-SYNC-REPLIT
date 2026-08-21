---
name: PortfolioState org id for client_admin
description: PortfolioState.organizationId is null for client_admin users; derive the org id via the organization record fallback for any per-org key.
---

# Deriving the org id in the portfolio web-portal pages

`window.PortfolioState.organizationId` is populated only on the **admin**
bootstrap path (admin fetches a specific org by id). On the **client_admin**
path the server resolves the org from the session, so the field is left
`null` — even though `PortfolioState.organization` is fully populated.

Any per-org key (localStorage keys, cache keys, query params) must derive
the id defensively:

```js
var orgId = state.organizationId || (state.organization && state.organization.id) || '';
```

**Why:** using `state.organizationId` alone silently collapses every
client_admin user's per-org preference onto a single shared key (e.g.
`pfm-color-by-`), so a preference saved in one org leaks into another and
the value looks "sticky" or "wrong" rather than throwing. It fails quietly
and only for the non-admin role, so it survives admin-only manual testing.

**How to apply:** whenever you persist or namespace anything by org in
`public/portfolio/**`, use the fallback chain above rather than reading
`organizationId` directly. Test the client_admin role explicitly — the admin
role will not reveal this bug.
