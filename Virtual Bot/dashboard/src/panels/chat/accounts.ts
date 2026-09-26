export const MAIN_ACCOUNT_KEY = 'claudeBotMainAccount';

/**
 * The account the owner picked leads the panel. If it is gone (disconnected
 * from OpenClaw) or nothing was picked, the server's first account leads:
 * the server sorts quota-reporting accounts first, then by traffic.
 */
export function splitAccounts<T extends { provider: string }>(
  accounts: T[],
  preferred: string | null,
): { main: T | null; others: T[] } {
  const main = accounts.find((account) => account.provider === preferred) ?? accounts[0] ?? null;
  return { main, others: accounts.filter((account) => account !== main) };
}
