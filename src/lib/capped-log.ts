/** Mock-mode mail / WhatsApp / share logs are in-memory test aids; keep only the most recent entries so a long-running server cannot grow them forever. */
export const MOCK_LOG_LIMIT = 200;

export function pushCapped<T>(log: T[], item: T, limit = MOCK_LOG_LIMIT): void {
  log.push(item);
  if (log.length > limit) log.splice(0, log.length - limit);
}
