import { Router } from 'express';
import { authRouter } from './auth.js';
import { conversationsRouter } from './conversations.js';
import { customersRouter } from './customers.js';
import { appointmentsRouter, doctorsRouter } from './appointments.js';
import { agentsRouter } from './agents.js';
import { templatesRouter } from './templates.js';
import { reportsRouter } from './reports.js';
import { settingsRouter } from './settings.js';
import { statusRouter } from './status.js';
import { redflagRouter } from './redflag.js';
import { auditRouter } from './audit.js';
// Clinic suite (AgendaPro-parity modules).
import { servicesRouter } from './services.js';
import { publicRouter } from './public.js';
import { calendarRouter } from './calendar.js';
import { remindersRouter } from './reminders.js';
import { clinicalRouter } from './clinical.js';
import { billingRouter } from './billing.js';
import { inventoryRouter } from './inventory.js';
import { marketingRouter } from './marketing.js';
import { businessReportsRouter } from './businessReports.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/appointments', appointmentsRouter);
apiRouter.use('/doctors', doctorsRouter);
apiRouter.use('/agents', agentsRouter);
apiRouter.use('/templates', templatesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/status', statusRouter);
apiRouter.use('/redflag', redflagRouter);
apiRouter.use('/audit', auditRouter);

// --- Clinic suite ------------------------------------------------------------
// NOTE: /public, /billing/link/:token and /marketing/survey/:token are
// intentionally UNAUTHENTICATED (patient-facing booking, payment links,
// satisfaction surveys). Each of those routers rate-limits its own public paths.
apiRouter.use('/services', servicesRouter);
apiRouter.use('/public', publicRouter);
apiRouter.use('/calendar', calendarRouter);
apiRouter.use('/reminders', remindersRouter);
apiRouter.use('/clinical', clinicalRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/marketing', marketingRouter);
apiRouter.use('/reports-business', businessReportsRouter);
