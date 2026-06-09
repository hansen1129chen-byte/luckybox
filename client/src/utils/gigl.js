/**
 * Shared GIGL helpers — date defaults, status colors, formatting.
 */

/** Default date range: last 30 days */
export function defaultDateFrom() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
export function defaultDateTo() {
  return new Date().toISOString().slice(0, 10);
}

/** GIGL status code → timeline color */
const STATUS_COLORS = { CRT:'#909399', DSC:'#409EFF', APT:'#409EFF', DCC:'#409EFF', DPC:'#409EFF', ARF:'#E6A23C', AST:'#E6A23C', WC:'#409EFF', OKC:'#67C23A', OKT:'#67C23A', DFA:'#F56C6C', SSC:'#F56C6C' };
export function timelineColor(code) { return STATUS_COLORS[code] || '#909399'; }

/** Format a date/time for display */
export function fmtDateTime(d) {
  if (!d) return '-';
  const t = new Date(d);
  return t.toLocaleDateString('en-GB') + ' ' + t.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
export function fmtDate(d) {
  if (!d) return '-';
  const t = new Date(d);
  return t.toLocaleDateString('en-GB') + ' ' + t.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}
