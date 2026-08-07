import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import * as calendar from '../services/calendar/service.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to, doctorId, serviceId } = req.query;
    res.json({ appointments: await calendar.calendarRange({ from, to, doctorId, serviceId }) });
  }),
);

// Drag & drop target: moves the block to a new start, doctor and/or duration.
calendarRouter.patch(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const { start, doctorId, durationMinutes } = req.body || {};
    const appointment = await calendar.rescheduleAppointment({
      id: req.params.id,
      start,
      doctorId,
      durationMinutes,
      agentId: req.agent.id,
      agentName: req.agent.name,
    });
    res.json({ appointment });
  }),
);

calendarRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    res.json({ appointment: await calendar.setAppointmentStatus(req.params.id, status) });
  }),
);
