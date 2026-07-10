// Appointment service with real-time overlap/double-booking prevention (§4, §12).
// Overlap is enforced inside a Serializable transaction so two concurrent
// bookings for the same doctor cannot both succeed.
import { prisma } from '../../db/prisma.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { emitAll } from '../../realtime/emitter.js';
import { EVENTS } from '../../realtime/events.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function withinAvailability(doctor, start, end) {
  const av = doctor.availability;
  if (!av || !av.week) return true; // no schedule configured => unrestricted
  const windows = av.week[DAY_KEYS[start.getDay()]] || [];
  if (windows.length === 0) return false;
  const toMin = (d) => d.getHours() * 60 + d.getMinutes();
  const s = toMin(start);
  const e = toMin(end);
  return windows.some((w) => {
    const [wh, wm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    return s >= wh * 60 + wm && e <= eh * 60 + em;
  });
}

export async function listDoctors() {
  return prisma.doctor.findMany({ orderBy: { name: 'asc' } });
}

export async function createDoctor({ name, specialty, availability }) {
  if (!name) throw new ValidationError('Doctor name is required');
  return prisma.doctor.create({ data: { name, specialty: specialty || null, availability: availability || null } });
}

export async function listAppointments({ doctorId, customerId, from, to, status } = {}) {
  const where = {};
  if (doctorId) where.doctorId = doctorId;
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (from || to) {
    where.scheduledAt = {};
    if (from) where.scheduledAt.gte = new Date(from);
    if (to) where.scheduledAt.lte = new Date(to);
  }
  return prisma.appointment.findMany({
    where,
    include: {
      doctor: { select: { id: true, name: true, specialty: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function bookAppointment({
  doctorId,
  customerId,
  conversationId,
  scheduledAt,
  durationMinutes = 30,
  reason,
  agentId,
}) {
  if (!doctorId || !customerId || !scheduledAt) {
    throw new ValidationError('doctorId, customerId and scheduledAt are required');
  }
  const start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) throw new ValidationError('Invalid scheduledAt');
  if (start.getTime() < Date.now()) throw new ValidationError('Cannot book an appointment in the past');
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new NotFoundError('Doctor not found');
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new NotFoundError('Customer not found');

  if (!withinAvailability(doctor, start, end)) {
    throw new ConflictError("Requested time is outside the doctor's availability", {
      code: 'OUTSIDE_AVAILABILITY',
    });
  }

  const appointment = await prisma.$transaction(
    async (tx) => {
      const conflicts = await tx.appointment.findMany({
        where: {
          doctorId,
          status: 'CONFIRMED',
          scheduledAt: { lt: end },
          endsAt: { gt: start },
        },
      });
      if (conflicts.length > 0) {
        throw new ConflictError('This doctor already has an appointment overlapping that time', {
          code: 'DOUBLE_BOOKING',
          conflicts: conflicts.map((a) => ({ id: a.id, scheduledAt: a.scheduledAt, endsAt: a.endsAt })),
        });
      }
      return tx.appointment.create({
        data: {
          doctorId,
          customerId,
          conversationId: conversationId || null,
          scheduledAt: start,
          endsAt: end,
          durationMinutes,
          reason: reason || null,
          createdByAgentId: agentId || null,
          status: 'CONFIRMED',
        },
        include: {
          doctor: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );

  emitAll(EVENTS.APPOINTMENT_CREATED, { appointment });
  return appointment;
}

export async function cancelAppointment(id) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw new NotFoundError('Appointment not found');
  const updated = await prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
  emitAll(EVENTS.APPOINTMENT_CREATED, { appointment: updated });
  return updated;
}

// Slot grid for a doctor on a date — powers the booking UI and shows conflicts.
export async function availableSlots({ doctorId, date, durationMinutes }) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new NotFoundError('Doctor not found');
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) throw new ValidationError('Invalid date');

  const av = doctor.availability || {};
  const windows = av.week?.[DAY_KEYS[day.getDay()]] || [];
  const slotMin = durationMinutes || av.slotMinutes || 30;

  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  const appts = await prisma.appointment.findMany({
    where: { doctorId, status: 'CONFIRMED', scheduledAt: { gte: dayStart, lte: dayEnd } },
  });

  const slots = [];
  for (const w of windows) {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    let cur = new Date(day);
    cur.setHours(sh, sm, 0, 0);
    const winEnd = new Date(day);
    winEnd.setHours(eh, em, 0, 0);
    while (cur.getTime() + slotMin * 60000 <= winEnd.getTime()) {
      const slotEnd = new Date(cur.getTime() + slotMin * 60000);
      const taken = appts.some((a) =>
        overlaps(cur, slotEnd, new Date(a.scheduledAt), new Date(a.endsAt)),
      );
      const isPast = cur.getTime() < Date.now();
      slots.push({ start: new Date(cur).toISOString(), end: slotEnd.toISOString(), available: !taken && !isPast });
      cur = new Date(cur.getTime() + slotMin * 60000);
    }
  }
  return { doctorId, date: day.toISOString().slice(0, 10), slotMinutes: slotMin, slots };
}
