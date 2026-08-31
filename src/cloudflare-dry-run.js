import { readLiveSignals } from './tibo/live-signals.js';

try {
  const result = await readLiveSignals({ maxAgeHours: 48 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
}
