// Deterministic mock AI replies — used when no ANTHROPIC_API_KEY is set so the
// offline-coverage feature is fully testable without external calls.
export async function generateMockReply({ latestInbound, customerName }) {
  const text = (latestInbound || '').toLowerCase();
  const who = customerName ? ` ${customerName}` : '';

  if (/price|cost|cu[aá]nto|precio|fee/.test(text)) {
    return `Thanks for reaching out${who}! A consultation starts at $600 MXN. Our team can confirm the details and help you book — is there a day that works best for you?`;
  }
  if (/appointment|book|agenda|cita|schedule|reservar/.test(text)) {
    return `I'd be glad to help you book an appointment. Could you tell me which day and roughly what time suits you, and whether you have a preferred doctor? A team member will confirm shortly.`;
  }
  if (/hour|open|abierto|horario|schedule/.test(text)) {
    return `We're open Monday to Friday, 9:00–13:00 and 14:00–18:00. How can we help you today?`;
  }
  if (/^(hi|hello|hola|buenas|hey)/.test(text)) {
    return `Hello${who}! Thanks for messaging WeEvolveit Clinic. How can I help you today?`;
  }
  return `Thanks for your message${who}! Our team is offline right now, but I can help with questions about our services, pricing, hours, and booking. Could you tell me a bit more about what you need?`;
}
