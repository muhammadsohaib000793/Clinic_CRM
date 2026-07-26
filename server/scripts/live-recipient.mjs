// Create a CRM conversation for a REAL verified WhatsApp recipient, so you can
// send it an approved template from the inbox (a real outbound live test).
//
// Usage (from the project root):
//   node server/scripts/live-recipient.mjs <number-digits> ["Display Name"]
// Example:
//   node server/scripts/live-recipient.mjs 19562721609 "Live Test"
//
// The conversation is created window-CLOSED + opted-in, so the composer offers
// the approved-template path (the only way to initiate on WhatsApp).
import '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';

const number = (process.argv[2] || '').replace(/\D/g, '');
const name = process.argv[3] || `Live Test (WhatsApp) ${number.slice(-4)}`;

if (!number) {
  console.error('Usage: node server/scripts/live-recipient.mjs <number-digits> ["Display Name"]');
  process.exit(1);
}

const existing = await prisma.channelIdentity.findUnique({
  where: { channel_externalId: { channel: 'WHATSAPP', externalId: number } },
  include: { customer: true },
});

let customer;
if (existing) {
  customer = existing.customer;
  await prisma.customer.update({ where: { id: customer.id }, data: { optedIn: true, optInAt: new Date() } });
} else {
  customer = await prisma.customer.create({
    data: {
      name,
      optedIn: true,
      optInAt: new Date(),
      contactInfo: { phone: `+${number}` },
      identities: { create: { channel: 'WHATSAPP', externalId: number } },
    },
  });
}

// Window CLOSED (lastInboundAt = null) so the CRM uses the TEMPLATE path.
const conversation = await prisma.conversation.upsert({
  where: { customerId_channel: { customerId: customer.id, channel: 'WHATSAPP' } },
  update: { lastInboundAt: null, status: 'OPEN' },
  create: { customerId: customer.id, channel: 'WHATSAPP', status: 'OPEN' },
});

console.log('✅ Ready.');
console.log(`   Customer:     ${customer.name}`);
console.log(`   WhatsApp:     +${number}`);
console.log(`   Conversation: ${conversation.id}`);
console.log('Open the CRM inbox, click this customer, and send the "hello_world" template.');
await prisma.$disconnect();
