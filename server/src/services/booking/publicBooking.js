// Public (unauthenticated) self-service booking — backend for the 24/7 booking
// page. Every value here arrives from an anonymous visitor, so this module
// validates + length-caps + sanitises all input, books through the overlap-safe
// appointment service (never its own INSERT), and returns the absolute minimum
// data back. No messaging is sent from this path (§9A: opt-in + 24h window +
// approved template are required for any outbound message — reminders own that).
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { num } from '../../lib/money.js';
import { bookAppointment, availableSlots } from '../appointments/service.js';
import { emitAll } from '../../realtime/emitter.js';

const MAX_DAYS_AHEAD = 180;
const LIMITS = { name: 120, phone: 32, email: 160, notes: 500 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9\s\-().]{7,32}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Drop C0/C1 control characters (built by code point so no escape sequences are
// needed) and collapse the remaining whitespace.
function clean(value) {
  if (value === null || value === undefined) return '';
  let out = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    out += code < 32 || (code >= 127 && code < 160) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function text(value, field, max, { required = false } = {}) {
  const v = clean(value);
  if (!v) {
    if (required) throw new ValidationError(`${field} is required`);
    return '';
  }
  if (v.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return v;
}

function id(value, field) {
  const v = clean(value);
  if (!v) throw new ValidationError(`${field} is required`);
  if (!ID_RE.test(v)) throw new ValidationError(`Invalid ${field}`);
  return v;
}

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

// Same subscriber? Compare digits-only, tolerating a country-code prefix on one
// side (e.g. "+52 55 1234 5678" vs "5512345678").
function sameNumber(a, b) {
  const A = digitsOf(a);
  const B = digitsOf(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const n = Math.min(A.length, B.length, 10);
  return n >= 8 && A.slice(-n) === B.slice(-n);
}

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function assertDayInRange(day) {
  const today = startOfToday();
  if (day.getTime() < today.getTime()) throw new ValidationError('That date is in the past');
  const max = new Date(today);
  max.setDate(max.getDate() + MAX_DAYS_AHEAD);
  if (day.getTime() > max.getTime()) {
    throw new ValidationError(`Bookings can only be made up to ${MAX_DAYS_AHEAD} days ahead`);
  }
}

// Accepts YYYY-MM-DD (or an ISO string) and builds a LOCAL date — availableSlots
// resolves weekday/slot times in local time, so parsing as UTC would shift days.
function parseDay(input) {
  const raw = clean(input);
  if (!raw) throw new ValidationError('date is required');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new ValidationError('date must be in YYYY-MM-DD format');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const day = new Date(y, mo - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== mo - 1 || day.getDate() !== d) {
    throw new ValidationError('That date does not exist');
  }
  assertDayInRange(day);
  return day;
}

// A service is bookable online only when it is active, flagged bookableOnline and
// has at least one professional who is also active + bookableOnline.
async function loadBookableService(serviceId) {
  const service = await prisma.service.findFirst({
    where: { id: id(serviceId, 'serviceId'), active: true, bookableOnline: true },
    include: {
      doctors: {
        include: {
          doctor: { select: { id: true, name: true, specialty: true, active: true, bookableOnline: true } },
        },
      },
    },
  });
  if (!service) throw new NotFoundError('Service not available for online booking');
  const doctors = (service.doctors || [])
    .map((ds) => ds.doctor)
    .filter((d) => d && d.active && d.bookableOnline)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (doctors.length === 0) throw new NotFoundError('No professionals are available for this service');
  return { service, doctors };
}

export async function publicServices() {
  const services = await prisma.service.findMany({
    where: { active: true, bookableOnline: true },
    orderBy: { name: 'asc' },
    include: {
      doctors: {
        include: {
          doctor: { select: { id: true, name: true, specialty: true, active: true, bookableOnline: true } },
        },
      },
    },
  });

  return services
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      price: num(s.price), // Decimal -> number
      category: s.category,
      color: s.color,
      doctors: (s.doctors || [])
        .map((ds) => ds.doctor)
        .filter((d) => d && d.active && d.bookableOnline)
        .map((d) => ({ id: d.id, name: d.name, specialty: d.specialty }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((s) => s.doctors.length > 0); // nothing bookable => don't offer it
}

// Only slot TIMES leave this function — never the doctor roster or any patient data.
export async function publicAvailability({ serviceId, doctorId, date }) {
  const { service, doctors } = await loadBookableService(serviceId);
  const day = parseDay(date);

  const wanted = clean(doctorId);
  const chosen = wanted && wanted !== 'any' ? doctors.filter((d) => d.id === wanted) : doctors;
  if (chosen.length === 0) throw new NotFoundError('That professional does not offer this service');

  const grids = await Promise.all(
    chosen.map((d) => availableSlots({ doctorId: d.id, date: day, durationMinutes: service.durationMinutes })),
  );

  // Union across professionals; identical start times dedupe to the first doctor.
  const byStart = new Map();
  grids.forEach((grid, i) => {
    for (const slot of grid.slots || []) {
      if (!slot.available || byStart.has(slot.start)) continue;
      byStart.set(slot.start, { start: slot.start, end: slot.end, available: true, doctorId: chosen[i].id });
    }
  });

  const slots = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
  return { date: ymd(day), slotMinutes: service.durationMinutes, slots };
}

// Resolve the patient behind an ANONYMOUS booking.
//
// SECURITY: this input is unauthenticated, so a single identifier must never be
// enough to adopt an existing patient record — otherwise anyone who knows a
// patient's email (or phone) could write appointments and free-text notes into
// that patient's chart, and the reminder engine would then message the real
// patient about a visit they never made.
// Rules:
//   * We only ever match on PHONE digits (phone is required and is the stronger
//     identifier for a clinic). An email alone NEVER matches.
//   * If the caller also supplied an email and the matched record has a
//     DIFFERENT email on file, we treat it as a different person and create a
//     new record rather than merging on a contradiction.
//   * An existing record is never mutated from public input (no name/email
//     overwrite) — staff reconcile duplicates from the Customers screen.
async function resolveCustomer({ name, phone, email }) {
  const digits = digitsOf(phone);
  // Narrow in SQL on the last 4 digits (contiguous in every common format), then
  // do the real digits-only comparison in JS.
  const candidates = await prisma.customer.findMany({
    where: { phone: { contains: digits.slice(-4) } },
    select: { id: true, name: true, phone: true, email: true },
    take: 200,
  });
  const byPhone = candidates.find((c) => sameNumber(c.phone, digits));
  if (byPhone) {
    const emailConflict =
      email && byPhone.email && byPhone.email.toLowerCase() !== email.toLowerCase();
    if (!emailConflict) return { id: byPhone.id, name: byPhone.name };
  }

  return prisma.customer.create({
    data: { name, phone, email: email || null, optedIn: false }, // §9A: no implicit opt-in
    select: { id: true, name: true },
  });
}

export async function publicBook({ serviceId, doctorId, start, name, phone, email, notes }) {
  const { service, doctors } = await loadBookableService(serviceId);

  const cleanName = text(name, 'Name', LIMITS.name, { required: true });
  if (cleanName.length < 2) throw new ValidationError('Please enter your full name');
  const cleanPhone = text(phone, 'Phone', LIMITS.phone, { required: true });
  if (!PHONE_RE.test(cleanPhone) || digitsOf(cleanPhone).length < 7) {
    throw new ValidationError('Please enter a valid phone number');
  }
  const cleanEmail = text(email, 'Email', LIMITS.email);
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) throw new ValidationError('Please enter a valid email address');
  const cleanNotes = text(notes, 'Notes', LIMITS.notes);

  const startAt = new Date(clean(start));
  if (Number.isNaN(startAt.getTime())) throw new ValidationError('Invalid appointment time');
  if (startAt.getTime() < Date.now()) throw new ValidationError('That time has already passed');
  const day = new Date(startAt);
  day.setHours(0, 0, 0, 0);
  assertDayInRange(day);

  const wanted = clean(doctorId);
  const candidates = wanted && wanted !== 'any' ? doctors.filter((d) => d.id === wanted) : doctors;
  if (candidates.length === 0) throw new NotFoundError('That professional does not offer this service');

  // The requested time must land exactly on a free slot of the service's grid —
  // this stops off-grid times coming from public input. Checked before creating
  // any customer row so a failed booking leaves nothing behind.
  const grids = await Promise.all(
    candidates.map((d) => availableSlots({ doctorId: d.id, date: day, durationMinutes: service.durationMinutes })),
  );
  const eligible = candidates.filter((d, i) =>
    (grids[i].slots || []).some((s) => s.available && new Date(s.start).getTime() === startAt.getTime()),
  );
  if (eligible.length === 0) {
    throw new ConflictError('That time is no longer available — please choose another slot', { code: 'SLOT_TAKEN' });
  }

  const customer = await resolveCustomer({ name: cleanName, phone: cleanPhone, email: cleanEmail });

  // bookAppointment is the only thing that writes the row (Serializable overlap
  // guard); if a slot is taken between the check and the insert, try the next pro.
  let lastConflict = null;
  for (const doctor of eligible) {
    let appointment;
    try {
      appointment = await bookAppointment({
        doctorId: doctor.id,
        customerId: customer.id,
        scheduledAt: startAt,
        durationMinutes: service.durationMinutes,
        reason: `Online booking — ${service.name}`,
        serviceId: service.id,
        source: 'ONLINE',
        notes: cleanNotes || null,
      });
    } catch (e) {
      if (e instanceof ConflictError) {
        lastConflict = e; // taken between check and insert — try the next professional
        continue;
      }
      throw e;
    }

    emitAll('appointment:created', { appointment });

    // Minimal confirmation: nothing about other records, and the name echoed back
    // is the one just submitted (never a matched customer's stored name).
    return {
      id: appointment.id,
      start: appointment.scheduledAt.toISOString(),
      end: appointment.endsAt.toISOString(),
      doctorName: doctor.name,
      serviceName: service.name,
      customerName: cleanName,
    };
  }

  throw (
    lastConflict ||
    new ConflictError('That time is no longer available — please choose another slot', { code: 'SLOT_TAKEN' })
  );
}
