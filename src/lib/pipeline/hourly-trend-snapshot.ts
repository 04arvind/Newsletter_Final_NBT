/**
 * In-process scheduler for the trend snapshot collector.
 *
 * Calls the same `collectTrendSnapshot` that `GET /api/cron/trends` calls —
 * once at startup, then every hour for as long as the server runs. Each run
 * scores a rolling 24 hours ending at that moment; nothing here depends on
 * the 06:00 issue boundary.
 */

import { collectTrendSnapshot } from './daily-trend-ranking';

const HOUR_MS = 60 * 60 * 1000;

// Survives dev hot reloads, so a reload does not start a second timer.
const state = globalThis as typeof globalThis & { __hourlyTrendSnapshotTimer?: NodeJS.Timeout };

let running = false;

async function runOnce(): Promise<void> {
  // A slow run is never overlapped by the next tick.
  if (running) return;
  running = true;
  try {
    const { features } = await collectTrendSnapshot();
    console.log(`hourly trend snapshot stored (${features.length} topics)`);
  } catch (error) {
    console.error('hourly trend snapshot failed', error);
  } finally {
    running = false;
  }
}

export function startHourlyTrendSnapshots(): void {
  if (state.__hourlyTrendSnapshotTimer) return;
  state.__hourlyTrendSnapshotTimer = setInterval(runOnce, HOUR_MS);
  void runOnce();
}
