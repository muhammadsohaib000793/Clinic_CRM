// Approved-template lookup + rendering (§9A: template required to initiate on
// WhatsApp and to re-engage outside the 24h window).
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';

export async function lookupTemplate(name) {
  if (!name) return { found: false, approved: false, template: null };
  const template = await prisma.messageTemplate.findUnique({ where: { name } });
  if (!template) return { found: false, approved: false, template: null };
  return { found: true, approved: template.status === 'APPROVED', template };
}

// Replace {{1}}, {{2}}, … with positional params (for storing a readable copy
// of what was sent). Extra placeholders left intact are flagged by the caller.
export function renderTemplateBody(template, params = []) {
  let body = template.body || '';
  params.forEach((p, idx) => {
    body = body.split(`{{${idx + 1}}}`).join(String(p));
  });
  return body;
}

export async function listTemplates() {
  return prisma.messageTemplate.findMany({ orderBy: { name: 'asc' } });
}

const FIELDS = ['name', 'channel', 'language', 'status', 'category', 'body'];

export async function createTemplate(data = {}) {
  if (!data.name || !data.body) throw new ValidationError('Template name and body are required');
  try {
    return await prisma.messageTemplate.create({
      data: {
        name: data.name,
        channel: data.channel || 'WHATSAPP',
        language: data.language || 'en_US',
        status: data.status || 'PENDING',
        category: data.category || null,
        body: data.body,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') throw new ConflictError('A template with that name already exists');
    throw e;
  }
}

export async function updateTemplate(id, data = {}) {
  const patch = {};
  for (const k of FIELDS) if (data[k] !== undefined) patch[k] = data[k];
  try {
    return await prisma.messageTemplate.update({ where: { id }, data: patch });
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Template not found');
    if (e.code === 'P2002') throw new ConflictError('A template with that name already exists');
    throw e;
  }
}

export async function deleteTemplate(id) {
  try {
    await prisma.messageTemplate.delete({ where: { id } });
    return { ok: true, id };
  } catch (e) {
    if (e.code === 'P2025') throw new NotFoundError('Template not found');
    throw e;
  }
}
