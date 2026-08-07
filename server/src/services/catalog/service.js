// Services catalog: what the clinic sells (duration + price) and which
// professionals perform it (DoctorService join). Appointments stay
// doctor-centric — a Service is an optional descriptor that supplies the
// default duration and price.
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError } from '../../lib/errors.js';
import { num, money } from '../../lib/money.js';
import { emitAll } from '../../realtime/emitter.js';

const INCLUDE = {
  doctors: { include: { doctor: { select: { id: true, name: true, specialty: true, color: true } } } },
};

// Prisma Decimals (price, commissionRate) must never leave the service raw.
function shape(s) {
  const links = s.doctors || [];
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    durationMinutes: s.durationMinutes,
    price: num(s.price),
    category: s.category,
    color: s.color,
    active: s.active,
    bookableOnline: s.bookableOnline,
    commissionRate: num(s.commissionRate),
    doctorIds: links.map((l) => l.doctorId),
    doctors: links
      .filter((l) => l.doctor)
      .map((l) => ({ id: l.doctor.id, name: l.doctor.name, specialty: l.doctor.specialty, color: l.doctor.color })),
  };
}

// Query params arrive as strings ("true"), the AI/services pass real booleans.
function bool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
}

function requireDuration(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 5 || n > 480) {
    throw new ValidationError('durationMinutes must be a whole number between 5 and 480');
  }
  return n;
}

function requirePrice(value, label = 'price') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be a number >= 0`);
  return money(n);
}

function requireRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError('commissionRate must be between 0 and 100');
  return money(n);
}

// Normalise + verify a doctorIds payload; every id must exist before we link.
async function resolveDoctorIds(doctorIds) {
  if (!Array.isArray(doctorIds)) throw new ValidationError('doctorIds must be an array');
  const ids = [...new Set(doctorIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
  if (ids.length === 0) return [];
  const found = await prisma.doctor.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) {
    const known = new Set(found.map((d) => d.id));
    throw new NotFoundError(`Unknown doctor(s): ${ids.filter((id) => !known.has(id)).join(', ')}`);
  }
  return ids;
}

export async function listServices({ activeOnly, bookableOnline } = {}) {
  const where = {};
  if (bool(activeOnly)) where.active = true;
  const online = bool(bookableOnline);
  if (online !== undefined) where.bookableOnline = online;
  const services = await prisma.service.findMany({ where, include: INCLUDE, orderBy: { name: 'asc' } });
  return services.map(shape);
}

export async function getService(id) {
  const service = await prisma.service.findUnique({ where: { id }, include: INCLUDE });
  if (!service) throw new NotFoundError('Service not found');
  return shape(service);
}

export async function createService(data = {}) {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new ValidationError('Service name is required');

  const durationMinutes = requireDuration(data.durationMinutes === undefined ? 30 : data.durationMinutes);
  const price = requirePrice(data.price === undefined ? 0 : data.price);
  const commissionRate = requireRate(data.commissionRate === undefined ? 0 : data.commissionRate);
  const doctorIds = data.doctorIds === undefined ? [] : await resolveDoctorIds(data.doctorIds);

  const created = await prisma.service.create({
    data: {
      name,
      description: data.description || null,
      durationMinutes,
      price,
      category: data.category || null,
      color: data.color || null,
      active: data.active === undefined ? true : !!data.active,
      bookableOnline: data.bookableOnline === undefined ? true : !!data.bookableOnline,
      commissionRate,
      doctors: doctorIds.length ? { create: doctorIds.map((doctorId) => ({ doctorId })) } : undefined,
    },
    include: INCLUDE,
  });

  const service = shape(created);
  emitAll('service:changed', { action: 'created', service });
  return service;
}

export async function updateService(id, data = {}) {
  const patch = {};
  if (data.name !== undefined) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw new ValidationError('Service name cannot be empty');
    patch.name = name;
  }
  if (data.description !== undefined) patch.description = data.description || null;
  if (data.durationMinutes !== undefined) patch.durationMinutes = requireDuration(data.durationMinutes);
  if (data.price !== undefined) patch.price = requirePrice(data.price);
  if (data.category !== undefined) patch.category = data.category || null;
  if (data.color !== undefined) patch.color = data.color || null;
  if (data.active !== undefined) patch.active = !!data.active;
  if (data.bookableOnline !== undefined) patch.bookableOnline = !!data.bookableOnline;
  if (data.commissionRate !== undefined) patch.commissionRate = requireRate(data.commissionRate);

  const doctorIds = data.doctorIds === undefined ? null : await resolveDoctorIds(data.doctorIds);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.service.update({ where: { id }, data: patch });
      if (doctorIds) {
        // doctorIds is authoritative: replace the whole link set.
        await tx.doctorService.deleteMany({ where: { serviceId: id } });
        if (doctorIds.length) {
          await tx.doctorService.createMany({
            data: doctorIds.map((doctorId) => ({ serviceId: id, doctorId })),
            skipDuplicates: true,
          });
        }
      }
      return tx.service.findUnique({ where: { id }, include: INCLUDE });
    });

    const service = shape(updated);
    emitAll('service:changed', { action: 'updated', service });
    return service;
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Service not found');
    throw e;
  }
}

export async function deleteService(id) {
  try {
    await prisma.service.delete({ where: { id } });
    emitAll('service:changed', { action: 'deleted', serviceId: id });
    return { ok: true, id };
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Service not found');
    throw e;
  }
}

export async function listServicesForDoctor(doctorId) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
  if (!doctor) throw new NotFoundError('Doctor not found');
  const services = await prisma.service.findMany({
    where: { doctors: { some: { doctorId } } },
    include: INCLUDE,
    orderBy: { name: 'asc' },
  });
  return services.map(shape);
}
