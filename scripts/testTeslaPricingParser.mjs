function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
function normalizeTeslaHtml(value) {
  return decodeEntities(value)
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|span|li|dt|dd|tr|td|th|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseDollar(value) {
  const n = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 2.5 ? Number(n.toFixed(2)) : null;
}
function priceAfterLabel(text, label) {
  const normalized = normalizeTeslaHtml(text);
  const idx = normalized.toLowerCase().indexOf(label.toLowerCase());
  if (idx < 0) return null;
  const slice = normalized.slice(idx, idx + 700);
  const match = slice.match(/\$\s*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:\/|per)?\s*(?:kwh|kw\s*h|kilowatt[-\s]?hour)/i);
  return match ? parseDollar(match[1]) : null;
}
const fixture = `
  <section>
    <h3>Pricing for Tesla &amp; Members</h3>
    <p>$0.29 / kWh</p>
    <h3>Pricing for Non-Tesla</h3>
    <p>$0.39 / kWh</p>
  </section>
`;
const member = priceAfterLabel(fixture, 'Pricing for Tesla & Members');
const nonMember = priceAfterLabel(fixture, 'Pricing for Non-Tesla');
if (member !== 0.29) throw new Error(`Member parser failed, expected 0.29 got ${member}`);
if (nonMember !== 0.39) throw new Error(`Non-member parser failed, expected 0.39 got ${nonMember}`);
console.log('Tesla pricing parser regression passed.');
