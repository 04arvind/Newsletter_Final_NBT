/**
 * Runs once when a Next.js server instance starts. Only the Node.js runtime
 * starts the hourly trend snapshot — it needs MongoDB and a long-lived process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startHourlyTrendSnapshots } = await import('./lib/pipeline/hourly-trend-snapshot');
    startHourlyTrendSnapshots();
  }
}
