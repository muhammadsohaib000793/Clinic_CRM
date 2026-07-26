// Deterministic booking layer for the AI agent (§4: "AI ... booking appointments").
// The LLM never books directly (avoids hallucinated appointments). Instead we
// parse booking intent + a day/time from the patient's message, resolve a doctor,
// and book through the real appointment service — which enforces availability and
// overlap/double-booking prevention. Works with the mock or real Claude provider.
import { listDoctors, availableSlots, bookAppointment } from '../appointments/service.js';

const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const BOOK_INTENT = /\b(book|appointment|schedule|reserve|booking|appt|agenda|cita|reservar|agendar)\b/i;
const TIME_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/i;

// Lowercase + strip accents so word-boundary matching isn't fooled by the "ana"
// hidden inside "mañana"/"semana" (ñ is a non-word char to ASCII \b; stripping
// the accent turns it into a normal letter so \bana\b no longer matches).
const strip = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const nextWeekday = (now, dow) => {
  const x = startOfDay(now);
  let diff = (dow - x.getDay() + 7) % 7;
  if (diff === 0) diff = 7; // strictly the next occurrence
  return addDays(x, diff);
};

export function hasBookingSignal(text) {
  return BOOK_INTENT.test(text || '') || TIME_RE.test(text || '');
}

export function parseWhen(text, now = new Date()) {
  const t = strip(text);

  // ---- Day ----
  let date = null;
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const c = new Date(y, mo - 1, d);
      if (c.getMonth() === mo - 1 && c.getDate() === d) date = c;
    }
  }
  if (!date) {
    // D/M (validated; rejects garbage like 12/25 where month 25 would overflow)
    m = t.match(/\b(\d{1,2})[/\-](\d{1,2})\b/);
    if (m) {
      const d = +m[1], mo = +m[2];
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        const y = now.getFullYear();
        let c = new Date(y, mo - 1, d);
        if (c < startOfDay(now)) c = new Date(y + 1, mo - 1, d);
        if (c.getMonth() === mo - 1 && c.getDate() === d) date = c;
      }
    }
  }
  if (!date && /\btoday\b|\bhoy\b/.test(t)) date = startOfDay(now);
  if (!date && /\btomorrow\b|\bmanana\b/.test(t)) date = addDays(startOfDay(now), 1);
  if (!date) {
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      if (new RegExp(`\\b${name}\\b`).test(t)) { date = nextWeekday(now, dow); break; }
    }
  }

  // ---- Time (with an afternoon heuristic for ambiguous 1–7 without am/pm) ----
  let time = null;
  m = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (m) {
    let h = +m[1];
    const min = +m[2];
    const ap = m[3];
    if (ap === 'pm' && h < 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 7) h += 12; // "2:30" -> 14:30 (clinic afternoon)
    if (h <= 23 && min <= 59) time = { h, m: min };
  }
  if (!time) {
    m = t.match(/\b(\d{1,2})\s*(am|pm)\b/);
    if (m) {
      let h = +m[1];
      if (m[2] === 'pm' && h < 12) h += 12;
      if (m[2] === 'am' && h === 12) h = 0;
      time = { h, m: 0 };
    }
  }
  if (!time) {
    m = t.match(/\bat\s+(\d{1,2})\b/);
    if (m) { let h = +m[1]; if (h >= 1 && h <= 7) h += 12; time = { h, m: 0 }; }
  }
  return { date, time };
}

// Resolve the doctor by name/specialty using accent-insensitive, word-boundary
// matching. Returns null when nothing matches confidently — the caller then ASKS
// which doctor rather than silently defaulting to an arbitrary specialist.
async function resolveDoctor(text) {
  const doctors = await listDoctors();
  if (doctors.length === 0) return null;
  const T = strip(text);
  const hasWord = (w) => w && new RegExp(`\\b${escapeRe(w)}\\b`).test(T);

  for (const d of doctors) {
    const full = strip(d.name.replace(/^dr\.?\s*/i, ''));
    const parts = full.split(/\s+/).filter((p) => p.length > 2);
    if ((full && T.includes(full)) || parts.some(hasWord)) return d;
  }
  for (const d of doctors) {
    const spec = strip(d.specialty || '');
    if (spec && spec.split(/\s+/).some((w) => w.length > 3 && hasWord(w))) return d;
  }
  if (/dermat|\bskin\b|\bpiel\b/.test(T)) {
    const d = doctors.find((x) => /dermat/i.test(x.specialty || ''));
    if (d) return d;
  }
  if (/dental|\bteeth\b|\btooth\b|dentist|limpieza|\bdiente/.test(T)) {
    const d = doctors.find((x) => /dent/i.test(x.specialty || ''));
    if (d) return d;
  }
  return null;
}

// Returns { status, doctor?, appointment?, when?, date?, missing? }.
export async function attemptAiBooking({ conversationId, customerId, text, now = new Date() }) {
  if (!hasBookingSignal(text)) return { status: 'no_intent' };

  const doctor = await resolveDoctor(text);
  if (!doctor) return { status: 'no_doctor' };

  const { date, time } = parseWhen(text, now);
  const missing = [];
  if (!date) missing.push('day');
  if (!time) missing.push('time');
  if (missing.length) return { status: 'need_info', missing, doctor };

  const requested = new Date(date);
  requested.setHours(time.h, time.m, 0, 0);
  if (requested.getTime() < now.getTime()) return { status: 'past', doctor };

  // Pass the Date object (not a YYYY-MM-DD string): availableSlots resolves the
  // weekday and slot times in LOCAL time, so re-serializing to a UTC date string
  // here would shift the day on machines ahead of/behind UTC.
  // Only ever books the requested slot or the nearest AT/AFTER it — never an
  // earlier slot the patient didn't ask for (returns no_availability instead).
  const bookFrom = async () => {
    const { slots } = await availableSlots({ doctorId: doctor.id, date });
    const avail = slots.filter((s) => s.available);
    if (avail.length === 0) return null;
    return (
      avail.find((s) => new Date(s.start).getTime() === requested.getTime()) ||
      avail.find((s) => new Date(s.start).getTime() >= requested.getTime()) ||
      null
    );
  };

  let chosen = await bookFrom();
  if (!chosen) return { status: 'no_availability', doctor, date };

  // Two attempts to absorb a slot being taken between check and book.
  for (let i = 0; i < 2; i++) {
    try {
      const appointment = await bookAppointment({
        doctorId: doctor.id,
        customerId,
        conversationId,
        scheduledAt: chosen.start,
        durationMinutes: 30,
        reason: 'Booked by AI assistant',
      });
      return { status: 'booked', doctor, appointment, when: new Date(chosen.start) };
    } catch {
      chosen = await bookFrom();
      if (!chosen) return { status: 'no_availability', doctor, date };
    }
  }
  return { status: 'no_availability', doctor, date };
}

export function bookingReply({ result, customerName }) {
  const who = customerName ? ` ${customerName}` : '';
  const day = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  switch (result.status) {
    case 'booked':
      return `Great${who}! I've booked you with ${result.doctor.name} on ${day(result.when)} at ${time(result.when)}. If you need to change it, just let me know.`;
    case 'need_info': {
      const ask =
        result.missing.includes('day') && result.missing.includes('time')
          ? 'which day and roughly what time works for you'
          : result.missing.includes('day')
            ? 'which day works for you'
            : 'what time works for you';
      return `I'd be happy to book you with ${result.doctor.name}. Could you tell me ${ask}?`;
    }
    case 'no_availability':
      return `I'm sorry${who}, ${result.doctor.name} doesn't have an open slot at that time on ${day(result.date)}. Would another day or time work?`;
    case 'past':
      return `That time has already passed — could you share a future day and time, and I'll get you booked?`;
    case 'no_doctor':
      return `I'd be glad to help you book. Which doctor or type of visit did you have in mind (for example dermatology, dentistry, or general medicine)?`;
    default:
      return null;
  }
}
