/**
 * importAcknowledgements.ts
 *
 * Shared acknowledgement contract for the admin importers.
 *
 * Both the master bill and the seasonal contract importer validate their source
 * data against the fixed pilot allowlist (`KNOWN_PNC_CODES`). When a code in
 * that list has no matching community row, the import must not silently drop
 * it — but neither should it be an unfixable hard block, because a branch
 * genuinely leaving the portfolio is a normal event.
 *
 * The agreed pattern (established for the master bill, generalised here) is:
 *
 *   1. The preview returns unmatched codes as *structured entries* rather than
 *      blocking-error strings, so the UI can render one checkbox per code.
 *   2. Commit stays blocked until every unmatched code is explicitly ticked.
 *   3. The commit re-derives community resolution server-side inside its own
 *      transaction and reconciles it against the posted acknowledgements. The
 *      client's preview object is untrusted input and is never the authority.
 *   4. The acknowledged codes are persisted on the batch record, so a later
 *      reader can explain why a branch is missing from an import.
 *
 * Deliberately NOT provided: any "acknowledge all" helper. Each exclusion is a
 * separate decision and must be ticked separately.
 */

/**
 * One code the importer could not resolve to a community, in a form the
 * preview UI can render as an acknowledgement checkbox.
 *
 * Importers extend this with their own descriptive fields (the master bill
 * adds the row count and dollar amount its skip will subtract; the seasonal
 * importer adds nothing but the pilot community name, because an unresolved
 * community there contributes no rows — it simply is not expanded into).
 */
export interface UnmatchedEntry {
  /** The unresolved code, e.g. "FB45". */
  code: string;
  /** Human-readable label for the code where one is known. Never required. */
  name?: string;
}

/**
 * Thrown when a commit request is rejected for a caller-correctable reason
 * (bad acknowledgement list, unacknowledged unmatched code, …). Carries an
 * HTTP status so the route layer does not have to string-match messages.
 */
export class ImportAcknowledgementError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ImportAcknowledgementError";
  }
}

/**
 * Coerce an untrusted request-body value into a clean, de-duplicated,
 * deterministically ordered list of acknowledged codes.
 */
export function normalizeAcknowledgedCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out].sort();
}

/**
 * Reconcile the codes the admin acknowledged against the codes the server
 * itself found unmatched. Both directions are checked:
 *
 *   (a) every acknowledged code must genuinely be unmatched server-side —
 *       otherwise a tampered request could name a resolvable code and have its
 *       rows silently dropped;
 *   (b) every server-unmatched code must be acknowledged — otherwise the
 *       commit would quietly omit data nobody signed off on.
 *
 * @param codeNoun How the code is described in error messages, e.g.
 *                 "PNC code" or "pilot community".
 * @returns The validated acknowledgement set, for the caller to act on.
 */
export function reconcileAcknowledgements(opts: {
  serverUnmatched: Iterable<string>;
  acknowledgedCodes: Iterable<string>;
  codeNoun: string;
}): { acknowledged: Set<string>; serverUnmatched: Set<string> } {
  const serverUnmatched = new Set(opts.serverUnmatched);
  const acknowledged    = new Set(opts.acknowledgedCodes);

  for (const code of acknowledged) {
    if (!serverUnmatched.has(code)) {
      throw new ImportAcknowledgementError(
        `Acknowledged code "${code}" was not flagged as unmatched in the preview — request rejected.`,
      );
    }
  }

  for (const code of serverUnmatched) {
    if (!acknowledged.has(code)) {
      throw new ImportAcknowledgementError(
        `Cannot commit — unmatched ${opts.codeNoun} "${code}" has not been acknowledged.`,
      );
    }
  }

  return { acknowledged, serverUnmatched };
}
