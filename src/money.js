export function parseAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  const text = String(value ?? '').trim();
  if (!text) return 0;

  const digits = text.replace(/[^\d]/g, '');
  return Math.max(0, Number.parseInt(digits || '0', 10));
}

export function roundAmount(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}