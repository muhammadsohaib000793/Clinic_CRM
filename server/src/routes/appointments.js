import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as appt from '../services/appointments/service.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

appointmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ appointments: await appt.listAppointments(req.query) });
  }),
);

appointmentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const appointment = await appt.bookAppointment({ ...req.body, agentId: req.agent.id });
    res.status(201).json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json({ appointment: await appt.cancelAppointment(req.params.id) });
  }),
);

// ---- Doctors (mounted separately at /api/doctors) --------------------------
export const doctorsRouter = Router();
doctorsRouter.use(requireAuth);

doctorsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ doctors: await appt.listDoctors() });
  }),
);

doctorsRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ doctor: await appt.createDoctor(req.body || {}) });
  }),
);

doctorsRouter.get(
  '/:id/slots',
  asyncHandler(async (req, res) => {
    const durationMinutes = req.query.durationMinutes ? Number(req.query.durationMinutes) : undefined;
    res.json(await appt.availableSlots({ doctorId: req.params.id, date: req.query.date, durationMinutes }));
  }),
);
