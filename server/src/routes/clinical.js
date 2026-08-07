// Clinical records (EHR) API. This is PHI: every read AND write is written to
// the audit trail, mirroring routes/customers.js.
// Attachments are uploaded as base64 inside the JSON body, so express.json's
// 2mb limit caps a single upload at roughly 1.5 MB of binary — a larger file is
// rejected by the body parser before it reaches here. The service still
// enforces the 5 MB limit and the mime allowlist on the DECODED buffer, because
// the body limit is configuration and the clinical limit is policy.
import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import * as clinical from '../services/clinical/service.js';
import { logAudit } from '../services/audit/service.js';

export const clinicalRouter = Router();
clinicalRouter.use(requireAuth);

clinicalRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = req.query.customerId || null;
    const records = await clinical.listRecords({ customerId, limit: req.query.limit });
    const summary = customerId ? await clinical.customerClinicalSummary(customerId) : null;
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'VIEW_CLINICAL_RECORDS',
      customerId,
      detail: `${records.length} record(s)`,
    });
    res.json({ records, summary });
  }),
);

clinicalRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await clinical.getRecord(req.params.id);
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'VIEW_CLINICAL_RECORD',
      customerId: record.customerId,
      detail: `record ${record.id}`,
    });
    res.json({ record });
  }),
);

clinicalRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const record = await clinical.createRecord(req.body || {}, req.agent);
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'CREATE_CLINICAL_RECORD',
      customerId: record.customerId,
      detail: `record ${record.id}`,
    });
    res.status(201).json({ record });
  }),
);

clinicalRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await clinical.updateRecord(req.params.id, req.body || {});
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'UPDATE_CLINICAL_RECORD',
      customerId: record.customerId,
      detail: `record ${record.id}: ${Object.keys(req.body || {}).join(', ')}`,
    });
    res.json({ record });
  }),
);

clinicalRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const result = await clinical.deleteRecord(req.params.id);
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'DELETE_CLINICAL_RECORD',
      customerId: result.customerId,
      detail: `record ${result.id}`,
    });
    res.json({ ok: true, id: result.id });
  }),
);

clinicalRouter.post(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const { attachment, customerId } = await clinical.addAttachment(req.params.id, req.body || {});
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'ADD_CLINICAL_ATTACHMENT',
      customerId,
      detail: `${attachment.filename} (${attachment.sizeBytes} bytes) on record ${req.params.id}`,
    });
    res.status(201).json({ attachment });
  }),
);

clinicalRouter.get(
  '/attachments/:attId',
  asyncHandler(async (req, res) => {
    const file = await clinical.getAttachment(req.params.attId);
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'DOWNLOAD_CLINICAL_ATTACHMENT',
      customerId: file.customerId,
      detail: `${file.filename} from record ${file.recordId}`,
    });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.split('"').join('')}"`);
    res.send(file.data);
  }),
);

clinicalRouter.delete(
  '/attachments/:attId',
  asyncHandler(async (req, res) => {
    const result = await clinical.deleteAttachment(req.params.attId);
    logAudit({
      agentId: req.agent.id,
      agentName: req.agent.name,
      action: 'DELETE_CLINICAL_ATTACHMENT',
      customerId: result.customerId,
      detail: `${result.filename} from record ${result.recordId}`,
    });
    res.json({ ok: true, id: result.id });
  }),
);
