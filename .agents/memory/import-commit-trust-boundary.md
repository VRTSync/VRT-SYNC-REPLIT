---
name: Import commit trust boundary
description: Why master-bill commit re-derives community and service-account resolution instead of trusting the posted preview object.
---

# Import commit trust boundary

The admin import flow is parse -> preview -> commit, and the client posts the
parse and preview objects back to the commit endpoint. Those objects are
untrusted input.

**Rule:** the commit path must re-derive every decision that controls what gets
written -- which PNC codes resolve to which community, which codes are
unmatched, and which service account owns created tasks -- by querying inside
its own transaction. The posted preview may drive display and cheap
pre-checks, never the authority for a write.

**Why:** acknowledgement checkboxes let an admin deliberately skip unmatched
codes. If the server trusted the posted unmatched list, a tampered request
could inject a code that actually *does* resolve, silently dropping its rows
from a billing import; or hide a genuinely unmatched code so its rows vanish
with no audit trail. Both are silent data loss on a financial import, and
neither shows up as an error anywhere.

**How to apply:** share one resolver helper between preview and commit, typed
against a minimal Queryable interface so preview passes the pool and commit
passes the transaction client. Validate the acknowledged set as a subset of
the *server-derived* unmatched set, and separately require every
server-derived unmatched code to be acknowledged. Surface rejections as a
typed error carrying an HTTP status, so the route branches on a property
instead of string-matching the message.
