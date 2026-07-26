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
