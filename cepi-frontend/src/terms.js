// Términos y condiciones de uso (LOPDP, PAPER §37). El texto vive en public/terminos.html y
// su versión vigente en public/terminos.json: la web, la APK y las apps nativas leen los dos
// del servidor, así que cambiar los términos es editar esos dos archivos y desplegar la web.
// A quien aceptó otra versión se le vuelve a pedir, sin actualizar ninguna app.
export const TERMS_URL = '/terminos.html';
export const TERMS_VERSION_URL = '/terminos.json';
// Solo si terminos.json no responde (sin red): la versión con la que se compiló este bundle.
export const FALLBACK_TERMS_VERSION = '2026-11-15';

export async function fetchCurrentTermsVersion() {
  try {
    const r = await fetch(TERMS_VERSION_URL, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j?.version) return String(j.version);
    }
  } catch { /* sin red: se usa la versión del bundle */ }
  return FALLBACK_TERMS_VERSION;
}

export function needsTermsAcceptance(user, currentVersion) {
  return !!user && !!currentVersion && user.terms_version !== currentVersion;
}
