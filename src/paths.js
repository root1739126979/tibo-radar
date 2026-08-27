import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectDirectory = path.resolve(sourceDirectory, '..');
export const dataDirectory = process.env.TIBO_RADAR_DATA_DIR
  ? path.resolve(process.env.TIBO_RADAR_DATA_DIR)
  : path.join(projectDirectory, 'data');
export const statePath = path.join(dataDirectory, 'state.json');
export const historyPath = path.join(dataDirectory, 'quota-history.jsonl');
export const eventsPath = path.join(dataDirectory, 'reset-events.jsonl');
export const errorsPath = path.join(dataDirectory, 'errors.log');
export const lockPath = path.join(dataDirectory, 'sample.lock');
