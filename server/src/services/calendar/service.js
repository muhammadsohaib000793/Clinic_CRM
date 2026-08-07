// Visual calendar / agenda backend: a bounded date-range feed that powers the
// day & week grids, plus drag & drop rescheduling and quick status changes.
// Rescheduling reuses the same overlap guarantees as booking (§4, §12): the
// conflict check and the update run inside one Serializable transaction so two
// agents dragging blocks at the same time cannot double-book a professional.
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { num } from '../../lib/money.js';
import { emitAll } from '../../realtime/emitter.js';
import { logAudit } from '../audit/service.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_RANGE_DAYS = 62;
const STATUSES = ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

const INCLUDE = {
  doctor: { select: { id: true, name: true, color: true } },
  customer: { select: { id: true, name: true, phone: true } },
  service: { select: { id: true, name: true, color: true, durationMinutes: true, price: true } },
};

// Local copy of the appointments-service rule (deliberately private to this
// module): the whole slot must fit inside one configured availability window.
function withinAvailability(doctor, start, end) {
  const av = doctor.availability;
  if (!av || !av.week) return true; // no schedule configured => unrestricted
  const windows = av.week[DAY_KEYS[start.getDay()]] || [];
  if (windows.length === 0) return false;
  const toMin = (d) => d.getHours() * 60 + d.getMinutes();
  const s = toMin(start);
  const e = toMin(end);
  return windows.some((w) => {
    const [wh, wm] = String(w.start).split(':').map(Number);
    const [eh, em] = String(w.end).split(':').map(Number);
    return s >= wh * 60 + wm && e <= eh * 60 + em;
  });
}

function parseDate(value, field) {
  if (value === undefined || value === null || value === '') throw new ValidationError(`${field} is required`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid ${field}`);
  return d;
}

// Single response shape for the whole module — Decimals are never leaked.
function shape(a) {
  return {
    id: a.id,
    start: new Date(a.scheduledAt).toISOString(),
    end: new Date(a.endsAt).toISOString(),
    durationMinutes: a.durationMinutes,
    status: a.status,
    source: a.source,
    reason: a.reason || null,
    notes: a.notes || null,
    doctor: a.doctor ? { id: a.doctor.id, name: a.doctor.name, color: a.doctor.color || null } : null,
    customer: a.customer ? { id: a.customer.id, name: a.customer.name, phone: a.customer.phone || null } : null,
    service: a.service
      ? {
          id: a.service.id,
          name: a.service.name,
          color: a.service.color || null,
          durationMinutes: a.service.durationMinutes,
          price: num(a.service.price),
        }
      : null,
  };
}

// Everything that overlaps [from, to) — an appointment starting before `from`
// but running into the window must still be drawn on the grid.
export async function calendarRange({ from, to, doctorId, serviceId } = {}) {
  const start = parseDate(from, 'from');
  const end = parseDate(to, 'to');
  if (end.getTime() <= start.getTime()) throw new ValidationError('`to` must be after `from`');
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400000) {
    throw new ValidationError(`Range too large — maximum ${MAX_RANGE_DAYS} days`);
  }

  const where = { scheduledAt: { lt: end }, endsAt: { gt: start } };
  if (doctorId) where.doctorId = doctorId;
  if (serviceId) where.serviceId = serviceId;

  const rows = await prisma.appointment.findMany({
    where,
    include: INCLUDE,
    orderBy: { scheduledAt: 'asc' },
  });
  return rows.map(shape);
}

export async function rescheduleAppointment({ id, start, doctorId, durationMinutes, agentId, agentName } = {}) {
  if (!id) throw new ValidationError('Appointment id is required');
  const newStart = parseDate(start, 'start');
  if (newStart.getTime() < Date.now()) throw new ValidationError('Cannot move an appointment into the past');

  const existing = await prisma.appointment.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Appointment not found');

  const targetDoctorId = doctorId || existing.doctorId;
  const minutes = Number(durationMinutes) > 0 ? Math.round(Number(durationMinutes)) : existing.durationMinutes;
  const newEnd = new Date(newStart.getTime() + minutes * 60000);

  const doctor = await prisma.doctor.findUnique({ where: { id: targetDoctorId } });
  if (!doctor) throw new NotFoundError('Doctor not found');

  if (!withinAvailability(doctor, newStart, newEnd)) {
    throw new ConflictError("Requested time is outside the professional's availability", {
      code: 'OUTSIDE_AVAILABILITY',
    });
  }

  const appointment = await prisma.$transaction(
    async (tx) => {
      const conflicts = await tx.appointment.findMany({
        where: {
          id: { not: id },
          doctorId: targetDoctorId,
          status: 'CONFIRMED',
          scheduledAt: { lt: newEnd },
          endsAt: { gt: newStart },
        },
        select: { id: true, scheduledAt: true, endsAt: true },
      });
      if (conflicts.length > 0) {
        throw new ConflictError('That professional already has an appointment overlapping that time', {
          code: 'DOUBLE_BOOKING',
          conflicts: conflicts.map((c) => ({
            id: c.id,
            scheduledAt: c.scheduledAt,
            endsAt: c.endsAt,
          })),
        });
      }
      return tx.appointment.update({
        where: { id },
        data: {
          doctorId: targetDoctorId,
          scheduledAt: newStart,
          endsAt: newEnd,
          durationMinutes: minutes,
        },
        include: INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' },
  );

  const result = shape(appointment);
  emitAll('appointment:updated', { appointment: result });
  logAudit({
    agentId: agentId || null,
    agentName: agentName || null,
    action: 'RESCHEDULE_APPOINTMENT',
    customerId: appointment.customerId,
    detail: `${new Date(existing.scheduledAt).toISOString()} -> ${result.start} (${result.doctor?.name || targetDoctorId})`,
  });
  return result;
}

export async function setAppointmentStatus(id, status) {
  if (!id) throw new ValidationError('Appointment id is required');
  if (!STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${STATUSES.join(', ')}`);
  }
  try {
    const appointment = await prisma.appointment.update({
      where: { id },
      data: { status },
      include: INCLUDE,
    });
    const result = shape(appointment);
    emitAll('appointment:updated', { appointment: result });
    return result;
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Appointment not found');
    throw e;
  }
}
