export const REQUEST_AGING_DAYS_THRESHOLD = 7;

export function isRequestAging(createdAt: string, thresholdDays: number = REQUEST_AGING_DAYS_THRESHOLD): boolean {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  return days >= thresholdDays;
}
