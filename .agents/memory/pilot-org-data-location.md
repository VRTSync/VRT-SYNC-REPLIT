---
name: Pilot org data lives only in production
description: The pilot (PNC) organization, its branches and branch groups exist only in the production DB; the dev DB has no organizations at all.
---

The pilot (PNC) organization and its real branches/groups exist **only in production**. The dev database contains zero rows in `organizations`, so migration seeds that key off the pilot org (e.g. group-set seeding) are silent no-ops in dev.

**Why:** Task work that says "then use it on the pilot org's data" cannot be finished in dev; the data operation must happen in production (via the admin UI after publish, or a prod-side script). Publishing pre-applies schema but seed data never travels via the diff.

**How to apply:** For verification in dev, build disposable fixtures (orgs/branches/groups/users via psql + bcryptjs hash) and clean them up afterwards. Flag any prod-only data step as drift/follow-up rather than claiming it done.
