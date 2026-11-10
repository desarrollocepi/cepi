// Celular y email del paciente (PAPER §36.1). Misma regla que cepi-bot/src/contacto.ts.

/**
 * Celular de Ecuador `09XXXXXXXX` o internacional con `+` y 8 a 15 dígitos. Acepta
 * espacios, guiones y paréntesis. Devuelve el número limpio o null.
 */
export function normalizeMobile(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^[+\d][\d\s().-]*$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) {
    if (digits.startsWith('593')) return digits.length === 12 && digits[3] === '9' ? '0' + digits.slice(3) : null;
    return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
  }
  if (/^09\d{8}$/.test(digits)) return digits;
  if (/^5939\d{8}$/.test(digits)) return '0' + digits.slice(3);
  if (/^9\d{8}$/.test(digits)) return '0' + digits;
  return null;
}

export function isValidEmail(raw) {
  return typeof raw === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export const MOBILE_HINT = 'Celular de 10 dígitos que empiece con 09 (o con + y el código del país).';
