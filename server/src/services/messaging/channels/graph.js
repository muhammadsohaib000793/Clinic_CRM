// Shared Meta Graph API helper. Node 18+ global fetch.
import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';

export function forcedDryRun() {
  const v = env.messagingDryRunForced;
  if (v === undefined || v === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

export function dryResult() {
  return { externalMessageId: `dryrun_${randomUUID()}`, dryRun: true, raw: { dryRun: true } };
}

export async function graphPost(pathSegment, token, body) {
  const url = `https://graph.facebook.com/${env.graphApiVersion}/${pathSegment}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `Graph API ${res.status}: ${data?.error?.message || 'unknown error'}`,
    );
    err.status = res.status;
    err.graphError = data?.error;
    throw err;
  }
  return data;
}
