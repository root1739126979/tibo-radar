import { readJson, writeJsonAtomic } from './storage.js';
import { redactServerChanSecret } from './serverchan.js';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function emptyOutbox() {
  return { version: 1, items: [] };
}

function clean(outbox, now) {
  const threshold = now.getTime() - RETENTION_MS;
  outbox.items = (Array.isArray(outbox.items) ? outbox.items : []).filter((item) => (
    item.status !== 'sent' || Date.parse(item.sentAt ?? '') >= threshold
  ));
  return outbox;
}

export async function readNotificationOutbox(filePath) {
  const value = await readJson(filePath, emptyOutbox());
  return value && Array.isArray(value.items) ? value : emptyOutbox();
}

export async function enqueueNotification(filePath, notification, { now = new Date() } = {}) {
  const outbox = clean(await readNotificationOutbox(filePath), now);
  const eventKey = String(notification.eventKey ?? '');
  if (!eventKey) throw new Error('Notification eventKey is required');
  if (!outbox.items.some((item) => item.eventKey === eventKey)) {
    outbox.items.push({
      eventKey,
      title: String(notification.title ?? ''),
      body: String(notification.body ?? ''),
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now.toISOString(),
      sentAt: null
    });
  }
  await writeJsonAtomic(filePath, outbox);
  return outbox.items.find((item) => item.eventKey === eventKey);
}

export async function pruneNotificationOutbox(filePath, { now = new Date() } = {}) {
  const outbox = clean(await readNotificationOutbox(filePath), now);
  await writeJsonAtomic(filePath, outbox);
  return outbox;
}

export async function processOneNotification(filePath, deliver, { now = new Date() } = {}) {
  const outbox = clean(await readNotificationOutbox(filePath), now);
  const item = outbox.items.find((candidate) => candidate.status === 'pending');
  if (!item) {
    await writeJsonAtomic(filePath, outbox);
    return { processed: false };
  }

  item.attempts = Number(item.attempts ?? 0) + 1;
  item.lastAttemptAt = now.toISOString();
  try {
    await deliver({ ...item });
    item.status = 'sent';
    item.sentAt = now.toISOString();
    item.lastError = null;
    await writeJsonAtomic(filePath, outbox);
    return { processed: true, eventKey: item.eventKey, status: 'sent' };
  } catch (error) {
    item.lastError = redactServerChanSecret(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 500);
    await writeJsonAtomic(filePath, outbox);
    throw new Error('App notification delivery failed; it remains pending for retry');
  }
}

export async function clearSentNotifications(filePath) {
  const outbox = await readNotificationOutbox(filePath);
  outbox.items = outbox.items.filter((item) => item.status !== 'sent');
  await writeJsonAtomic(filePath, outbox);
  return outbox.items.length;
}
