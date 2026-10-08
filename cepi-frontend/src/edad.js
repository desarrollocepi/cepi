/**
 * Años cumplidos a partir de la fecha de nacimiento, o `null` si no se puede saber.
 *
 * La fecha se lee por sus PARTES (año, mes, día), no con `new Date('1990-10-09')`: eso la
 * interpreta como medianoche UTC, que en Ecuador (UTC−5) es todavía el día 8, y la víspera
 * del cumpleaños el paciente salía un año mayor en la lista y en la ficha impresa.
 */
export function edadDesde(fechaNac, hoy = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaNac || ''));
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  let edad = hoy.getFullYear() - anio;
  const mesHoy = hoy.getMonth() + 1;
  if (mesHoy < mes || (mesHoy === mes && hoy.getDate() < dia)) edad--;
  return edad >= 0 && edad < 150 ? edad : null;
}
