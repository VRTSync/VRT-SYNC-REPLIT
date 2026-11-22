/**
 * Unwrap a Drizzle/pg error chain to find the underlying pg DatabaseError.
 * Drizzle wraps the native pg error inside DrizzleQueryError, so `error.constraint`
 * is undefined at the top level — we need to walk `.cause`.
 */
export function pgErrorOf(error: any): any {
  let e = error;
  while (e) {
    // pg DatabaseError has a numeric-string `code` like "23505"
    if (e?.code && typeof e.code === "string" && /^\d{5}$/.test(e.code)) return e;
    e = e?.cause ?? null;
  }
  return null;
}

export function isUniqueViolation(error: any, constraint?: string): boolean {
  const pg = pgErrorOf(error);
  if (!pg || pg.code !== "23505") return false;
  if (constraint) return pg.constraint === constraint;
  return true;
}
