// Approved-template lookup + rendering (§9A: template required to initiate on
// WhatsApp and to re-engage outside the 24h window).
import { prisma } from '../../db/prisma.js';

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
