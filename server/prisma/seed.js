// Seed script — demo data so the CRM is testable immediately.
// Idempotent for accounts/templates/doctors/settings (upsert by unique key);
// demo conversations are only created when the DB has no customers yet.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000);
const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

async function main() {
  console.log('Seeding…');
  // Demo agents + sample conversations are seeded only in dev / when SEED_DEMO=true.
  // Production (NODE_ENV=production) seeds just the admin, doctors, and templates —
  // real agents are then created through the Admin screen.
  const seedDemo = process.env.SEED_DEMO === 'true' || (process.env.NODE_ENV || 'development') !== 'production';

  // -- Settings ---------------------------------------------------------------
  await prisma.setting.upsert({
    where: { key: 'redflag_threshold_minutes' },
    update: {},
    create: { key: 'redflag_threshold_minutes', value: '15' },
  });

  // -- Admin account (credentials come from env; set ADMIN_PASSWORD before deploy) --
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@weevolveit.mx').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  await prisma.agent.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminHash, role: 'ADMIN' }, // env is the source of truth
    create: { name: 'Clinic Admin', email: adminEmail, passwordHash: adminHash, role: 'ADMIN' },
  });

  // -- Doctors ----------------------------------------------------------------
  const weekday = [
    { start: '09:00', end: '13:00' },
    { start: '14:00', end: '18:00' },
  ];
  const fullWeek = {
    slotMinutes: 30,
    week: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [], sun: [] },
  };
  const doctorDefs = [
    ['Dr. Ana Ruiz', 'Dermatology', '#7c3aed'],
    ['Dr. Luis Gómez', 'General Medicine', '#0ea5e9'],
    ['Dr. María Torres', 'Dentistry', '#f59e0b'],
  ];
  const doctors = [];
  for (const [name, specialty, color] of doctorDefs) {
    let doc = await prisma.doctor.findFirst({ where: { name } });
    if (!doc) {
      doc = await prisma.doctor.create({
        data: { name, specialty, color, availability: fullWeek, commissionRate: 10 },
      });
    }
    doctors.push(doc);
  }

  // -- Services catalog -------------------------------------------------------
  // Seeded in every environment (not just demo): the public booking page needs a
  // catalog to offer. The clinic edits/replaces these from Admin → Services.
  const serviceDefs = [
    ['Dermatology consultation', 'Skin check and diagnosis', 30, 800, 'Dermatology', '#7c3aed', [0]],
    ['General consultation', 'General medical consultation', 30, 600, 'General', '#0ea5e9', [1]],
    ['Dental cleaning', 'Professional dental cleaning', 45, 900, 'Dentistry', '#f59e0b', [2]],
    ['Dental check-up', 'Routine dental examination', 30, 500, 'Dentistry', '#f59e0b', [2]],
    ['Follow-up visit', 'Follow-up on a previous consultation', 20, 350, 'General', '#16a34a', [0, 1, 2]],
  ];
  for (const [name, description, durationMinutes, price, category, color, docIdx] of serviceDefs) {
    let svc = await prisma.service.findFirst({ where: { name } });
    if (!svc) {
      svc = await prisma.service.create({
        data: { name, description, durationMinutes, price, category, color, commissionRate: 10 },
      });
      for (const i of docIdx) {
        await prisma.doctorService.create({ data: { serviceId: svc.id, doctorId: doctors[i].id } });
      }
    }
  }

  // -- Reminder engine defaults ----------------------------------------------
  for (const [key, value] of [
    ['reminder.enabled', 'true'],
    ['reminder.offsetsHours', '[24]'],
    ['reminder.channels', '["WHATSAPP"]'],
    ['reminder.templateName', 'appointment_reminder'],
  ]) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // -- Message templates (§9A: approved templates for out-of-window reengage) -
  await prisma.messageTemplate.upsert({
    where: { name: 'hello_world' },
    update: {},
    create: {
      name: 'hello_world',
      channel: 'WHATSAPP',
      language: 'en_US',
      status: 'APPROVED',
      category: 'UTILITY',
      body: 'Hello! This is WeEvolveit Clinic. How can we help you today?',
    },
  });
  await prisma.messageTemplate.upsert({
    where: { name: 'appointment_reminder' },
    update: {},
    create: {
      name: 'appointment_reminder',
      channel: 'WHATSAPP',
      language: 'en_US',
      status: 'APPROVED',
      category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder of your appointment with {{2}}. Reply to confirm.',
    },
  });
  await prisma.messageTemplate.upsert({
    where: { name: 'reengage_followup' },
    update: {},
    create: {
      name: 'reengage_followup',
      channel: 'WHATSAPP',
      language: 'en_US',
      status: 'PENDING', // intentionally NOT approved — used to prove the guard blocks it
      category: 'MARKETING',
      body: 'Hi {{1}}, we noticed you were interested. Want to book a visit?',
    },
  });

  // -- Demo agents + conversations — skipped in production -------------------
  if (!seedDemo) {
    console.log(`Seed complete (production): admin (${adminEmail}) + doctors + services + templates.`);
    console.log('Create your agents from the Admin screen after logging in.');
    return;
  }

  // Demo inventory (dev/demo only — a real clinic loads its own stock).
  for (const [sku, name, category, price, cost, stock, threshold] of [
    ['SKU-001', 'Sunscreen SPF 50', 'Dermatology', 320, 180, 24, 5],
    ['SKU-002', 'Fluoride toothpaste', 'Dentistry', 95, 48, 40, 10],
    ['SKU-003', 'Vitamin C serum', 'Dermatology', 540, 300, 3, 5],
    ['SKU-004', 'Surgical masks (50)', 'General', 150, 70, 0, 8],
  ]) {
    await prisma.product.upsert({
      where: { sku },
      update: {},
      create: { sku, name, category, price, cost, stock, lowStockThreshold: threshold },
    });
  }

  const existingCustomers = await prisma.customer.count();
  if (existingCustomers > 0) {
    console.log('Customers already present — skipping demo conversation seed.');
    console.log('Seed complete.');
    return;
  }

  // Demo agents (dev/demo only — in production you create agents via Admin).
  const agentHash = await bcrypt.hash('Agent123!', 10);
  const agents = [];
  for (const [name, email] of [
    ['Sofia Martinez', 'sofia@weevolveit.mx'],
    ['Diego Herrera', 'diego@weevolveit.mx'],
    ['Valentina Cruz', 'valentina@weevolveit.mx'],
    ['Mateo Rojas', 'mateo@weevolveit.mx'],
    ['Camila Flores', 'camila@weevolveit.mx'],
  ]) {
    agents.push(
      await prisma.agent.upsert({ where: { email }, update: {}, create: { name, email, passwordHash: agentHash, role: 'AGENT' } }),
    );
  }

  // Helper to create a customer + channel identity + conversation + messages.
  async function seedThread({
    name, channel, externalId, optedIn, contactInfo, notes,
    lastInboundMinsAgo, lastOutboundMinsAgo, status, assignedAgent, messages,
  }) {
    const customer = await prisma.customer.create({
      data: {
        name,
        contactInfo,
        notes,
        optedIn,
        optInAt: optedIn ? hoursAgo(48) : null,
        identities: { create: { channel, externalId } },
      },
    });
    const lastInboundAt = lastInboundMinsAgo != null ? minsAgo(lastInboundMinsAgo) : null;
    const lastOutboundAt = lastOutboundMinsAgo != null ? minsAgo(lastOutboundMinsAgo) : null;
    const lastMessageAt = new Date(
      Math.max(lastInboundAt ? lastInboundAt.getTime() : 0, lastOutboundAt ? lastOutboundAt.getTime() : 0),
    );
    const conversation = await prisma.conversation.create({
      data: {
        customerId: customer.id,
        channel,
        status,
        assignedAgentId: assignedAgent ? assignedAgent.id : null,
        lastInboundAt,
        lastOutboundAt,
        lastMessageAt: lastMessageAt.getTime() ? lastMessageAt : null,
        flaggedAt: status === 'FLAGGED' ? minsAgo(2) : null,
      },
    });
    for (const m of messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: m.senderType,
          senderAgentId: m.senderType === 'AGENT' && assignedAgent ? assignedAgent.id : null,
          direction: m.senderType === 'CUSTOMER' ? 'INBOUND' : 'OUTBOUND',
          channel,
          content: m.content,
          status: m.senderType === 'CUSTOMER' ? null : 'sent',
          sentAt: minsAgo(m.minsAgo),
        },
      });
    }
    return { customer, conversation };
  }

  // 1) Fresh WhatsApp lead, opted-in, within window, unassigned (claimable).
  await seedThread({
    name: 'Lucía Fernández',
    channel: 'WHATSAPP',
    externalId: '5215500000001',
    optedIn: true,
    contactInfo: { phone: '+52 155 0000 0001' },
    notes: 'Interested in a dermatology consult.',
    lastInboundMinsAgo: 3,
    lastOutboundMinsAgo: null,
    status: 'OPEN',
    assignedAgent: null,
    messages: [
      { senderType: 'CUSTOMER', content: 'Hi, do you have availability this week for a skin check?', minsAgo: 3 },
    ],
  });

  // 2) Instagram, assigned to Sofia, within window, answered.
  await seedThread({
    name: 'Andrés Peña',
    channel: 'INSTAGRAM',
    externalId: 'ig_17800000000001',
    optedIn: true,
    contactInfo: { instagram: '@andres.pena' },
    notes: null,
    lastInboundMinsAgo: 20,
    lastOutboundMinsAgo: 18,
    status: 'OPEN',
    assignedAgent: agents[0],
    messages: [
      { senderType: 'CUSTOMER', content: 'How much is a cleaning?', minsAgo: 20 },
      { senderType: 'AGENT', content: 'Hi Andrés! A dental cleaning is $600 MXN. Would you like to book?', minsAgo: 18 },
    ],
  });

  // 3) Messenger, UNANSWERED past threshold -> will be red-flagged by scanner.
  await seedThread({
    name: 'Gabriela Soto',
    channel: 'MESSENGER',
    externalId: 'psid_24000000000001',
    optedIn: true,
    contactInfo: { facebook: 'Gabriela Soto' },
    notes: 'Asked about pricing 30+ min ago, no reply yet.',
    lastInboundMinsAgo: 32,
    lastOutboundMinsAgo: null,
    status: 'OPEN',
    assignedAgent: null,
    messages: [
      { senderType: 'CUSTOMER', content: 'Hola, cuánto cuesta una limpieza dental?', minsAgo: 32 },
    ],
  });

  // 4) WhatsApp, OUTSIDE 24h window, opted-in -> free-form blocked, template ok.
  await seedThread({
    name: 'Roberto Díaz',
    channel: 'WHATSAPP',
    externalId: '5215500000002',
    optedIn: true,
    contactInfo: { phone: '+52 155 0000 0002' },
    notes: 'Last messaged 2 days ago — window closed.',
    lastInboundMinsAgo: 60 * 30, // 30h ago
    lastOutboundMinsAgo: 60 * 29,
    status: 'OPEN',
    assignedAgent: agents[1],
    messages: [
      { senderType: 'CUSTOMER', content: 'Gracias por la info!', minsAgo: 60 * 30 },
      { senderType: 'AGENT', content: 'Con gusto, aquí estamos para lo que necesite.', minsAgo: 60 * 29 },
    ],
  });

  // 5) NOT opted-in customer -> any outbound blocked by opt-in gate.
  await seedThread({
    name: 'Prospecto Anónimo',
    channel: 'WHATSAPP',
    externalId: '5215500000003',
    optedIn: false,
    contactInfo: { phone: '+52 155 0000 0003' },
    notes: 'Has not opted in — used to prove no-cold-send rule.',
    lastInboundMinsAgo: null,
    lastOutboundMinsAgo: null,
    status: 'OPEN',
    assignedAgent: null,
    messages: [],
  });

  console.log('Seed complete (demo): admin + 5 agents + 3 doctors + 3 templates + 5 conversations.');
  console.log(`Admin login: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
