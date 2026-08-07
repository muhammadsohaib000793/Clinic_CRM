// Clinical records (EHR): structured per-visit fields plus attachments stored as
// bytes in Postgres. This is PHI — the route layer audits every read and write.
// Attachment BYTES are never included in a list/get response; only metadata is.
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError } from '../../lib/errors.js';
import { emitAll } from '../../realtime/emitter.js';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on the decoded file
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];

// Characters that would break a Content-Disposition header or a Windows save.
const UNSAFE_FILENAME_CHARS = '<>:"|?*';

// Metadata-only projection — deliberately omits `data` so bytes never leak into
// a JSON list response.
const ATTACHMENT_META = { id: true, filename: true, mimeType: true, sizeBytes: true, uploadedAt: true };

const RECORD_INCLUDE = {
  attachments: { select: ATTACHMENT_META, orderBy: { uploadedAt: 'asc' } },
  appointment: {
    select: { id: true, scheduledAt: true, doctor: { select: { id: true, name: true } } },
  },
};

const TEXT_FIELDS = ['reason', 'symptoms', 'diagnosis', 'treatment', 'prescription', 'notes'];

function parseDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid ${field}`);
  return d;
}

function textPatch(data) {
  const patch = {};
  for (const f of TEXT_FIELDS) {
    if (data[f] === undefined) continue;
    const v = data[f] === null ? '' : String(data[f]).trim();
    patch[f] = v || null;
  }
  return patch;
}

// Vitals are free-form key/values ({ bloodPressure, heartRate, ... }); drop the
// blanks so an untouched form does not store `{ heartRate: "" }`.
function cleanVitals(vitals) {
  if (vitals === null || vitals === undefined || vitals === '') return null;
  if (typeof vitals !== 'object' || Array.isArray(vitals)) throw new ValidationError('vitals must be an object');
  const out = {};
  for (const [k, v] of Object.entries(vitals)) {
    if (v === null || v === undefined) continue;
    const val = typeof v === 'string' ? v.trim() : v;
    if (val === '') continue;
    out[k] = val;
  }
  return Object.keys(out).length ? out : null;
}

// Basename only: drop any path segments, then strip control and header-breaking
// characters and cap the length.
function sanitizeFilename(name) {
  const base = String(name || 'attachment').split(/[\\/]/).pop() || 'attachment';
  const safe = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) > 31 && !UNSAFE_FILENAME_CHARS.includes(ch))
    .join('')
    .trim();
  return (safe || 'attachment').slice(0, 200);
}

export async function listRecords({ customerId, limit = 50 } = {}) {
  const take = Math.min(Number(limit) || 50, 200);
  return prisma.clinicalRecord.findMany({
    where: customerId ? { customerId } : {},
    orderBy: { visitDate: 'desc' },
    take,
    include: RECORD_INCLUDE,
  });
}

export async function getRecord(id) {
  const record = await prisma.clinicalRecord.findUnique({ where: { id }, include: RECORD_INCLUDE });
  if (!record) throw new NotFoundError('Clinical record not found');
  return record;
}

export async function createRecord(data = {}, agent = null) {
  const customerId = data.customerId;
  if (!customerId) throw new ValidationError('customerId is required');
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new NotFoundError('Customer not found');

  const appointmentId = data.appointmentId || null;
  if (appointmentId) {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, customerId: true },
    });
    if (!appt) throw new ValidationError('Appointment not found');
    if (appt.customerId !== customerId) {
      throw new ValidationError('Appointment does not belong to this patient');
    }
  }

  const record = await prisma.clinicalRecord.create({
    data: {
      customerId,
      appointmentId,
      authorAgentId: agent?.id || null,
      authorName: agent?.name || null,
      visitDate: parseDate(data.visitDate, 'visitDate') || new Date(),
      ...textPatch(data),
      vitals: cleanVitals(data.vitals),
      followUpAt: parseDate(data.followUpAt, 'followUpAt'),
    },
    include: RECORD_INCLUDE,
  });

  emitAll('clinical:record-created', { recordId: record.id, customerId });
  return record;
}

export async function updateRecord(id, data = {}) {
  const existing = await prisma.clinicalRecord.findUnique({
    where: { id },
    select: { id: true, customerId: true },
  });
  if (!existing) throw new NotFoundError('Clinical record not found');

  const patch = textPatch(data);
  if (data.visitDate !== undefined) {
    const d = parseDate(data.visitDate, 'visitDate');
    if (!d) throw new ValidationError('visitDate cannot be cleared');
    patch.visitDate = d;
  }
  if (data.followUpAt !== undefined) patch.followUpAt = parseDate(data.followUpAt, 'followUpAt');
  if (data.vitals !== undefined) patch.vitals = cleanVitals(data.vitals);
  if (data.appointmentId !== undefined) {
    if (!data.appointmentId) {
      patch.appointmentId = null;
    } else {
      const appt = await prisma.appointment.findUnique({
        where: { id: data.appointmentId },
        select: { id: true, customerId: true },
      });
      if (!appt) throw new ValidationError('Appointment not found');
      if (appt.customerId !== existing.customerId) {
        throw new ValidationError('Appointment does not belong to this patient');
      }
      patch.appointmentId = appt.id;
    }
  }

  const record = await prisma.clinicalRecord.update({ where: { id }, data: patch, include: RECORD_INCLUDE });
  emitAll('clinical:record-updated', { recordId: record.id, customerId: record.customerId });
  return record;
}

export async function deleteRecord(id) {
  const existing = await prisma.clinicalRecord.findUnique({
    where: { id },
    select: { id: true, customerId: true },
  });
  if (!existing) throw new NotFoundError('Clinical record not found');
  await prisma.clinicalRecord.delete({ where: { id } }); // cascades its attachments
  emitAll('clinical:record-deleted', { recordId: id, customerId: existing.customerId });
  return { ok: true, id, customerId: existing.customerId };
}

export async function addAttachment(recordId, { filename, mimeType, base64 } = {}) {
  const record = await prisma.clinicalRecord.findUnique({
    where: { id: recordId },
    select: { id: true, customerId: true },
  });
  if (!record) throw new NotFoundError('Clinical record not found');
  if (!base64) throw new ValidationError('base64 file content is required');
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new ValidationError(`Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  // Accept either raw base64 or a whole `data:<mime>;base64,…` URL from FileReader.
  const raw = String(base64);
  const payload = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length === 0) throw new ValidationError('File is empty or not valid base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new ValidationError('Attachment exceeds the 5 MB limit');

  const attachment = await prisma.clinicalAttachment.create({
    data: {
      recordId,
      filename: sanitizeFilename(filename),
      mimeType,
      sizeBytes: buffer.length,
      data: buffer,
    },
    select: ATTACHMENT_META,
  });
  return { attachment, customerId: record.customerId };
}

// Full payload INCLUDING bytes — only ever used by the download route.
export async function getAttachment(id) {
  const att = await prisma.clinicalAttachment.findUnique({
    where: { id },
    include: { record: { select: { id: true, customerId: true } } },
  });
  if (!att) throw new NotFoundError('Attachment not found');
  return {
    id: att.id,
    recordId: att.recordId,
    customerId: att.record?.customerId || null,
    filename: att.filename,
    mimeType: att.mimeType,
    sizeBytes: att.sizeBytes,
    data: Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data),
  };
}

export async function deleteAttachment(id) {
  const att = await prisma.clinicalAttachment.findUnique({
    where: { id },
    select: { id: true, recordId: true, filename: true, record: { select: { customerId: true } } },
  });
  if (!att) throw new NotFoundError('Attachment not found');
  await prisma.clinicalAttachment.delete({ where: { id } });
  return {
    ok: true,
    id,
    recordId: att.recordId,
    filename: att.filename,
    customerId: att.record?.customerId || null,
  };
}

export async function customerClinicalSummary(customerId) {
  if (!customerId) throw new ValidationError('customerId is required');
  const now = new Date();
  const [totalVisits, last, openFollowUps] = await Promise.all([
    prisma.clinicalRecord.count({ where: { customerId } }),
    prisma.clinicalRecord.findFirst({
      where: { customerId },
      orderBy: { visitDate: 'desc' },
      select: { visitDate: true },
    }),
    prisma.clinicalRecord.count({ where: { customerId, followUpAt: { gte: now } } }),
  ]);
  return { totalVisits, lastVisitAt: last?.visitDate || null, openFollowUps };
}

export { MAX_ATTACHMENT_BYTES, ALLOWED_MIME_TYPES };
