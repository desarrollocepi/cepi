/**
 * Imágenes que entran por un canal de chat.
 *
 * El canal baja el archivo de su proveedor y lo sube a TodoERP como adjunto,
 * **con el JWT de quien lo mandó** (queda a su nombre y dentro de su org). De
 * ahí en más es un id de adjunto, igual que una foto subida desde la web: va
 * como valor de un campo de imágenes de la ficha (CSV de ids) o, suelta, como
 * el marcador `[adjunto: nombre · id]` que el cerebro ya reconoce.
 */

/** Sube los bytes a `/api/attachments`. Devuelve el id del adjunto o null. */
export async function subirAdjunto(
  canal: string, jwt: string, buffer: Buffer, filename: string, mime: string,
): Promise<string | null> {
  const base = process.env.TODOERP_API_URL || 'http://localhost:3001';
  try {
    // Copy into a fresh Uint8Array so the Blob is backed by a plain
    // ArrayBuffer (TS rejects Buffer's ArrayBufferLike as a BlobPart).
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: mime }), filename);
    const r = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: fd,
    });
    if (!r.ok) { console.error(`[${canal}] attachment upload ${r.status}: ${await r.text()}`); return null; }
    const data: any = await r.json().catch(() => ({}));
    const att = Array.isArray(data) ? data[0] : data;
    return att?.id || null;
  } catch (e: any) {
    console.error(`[${canal}] uploadAttachment error:`, e?.message || e);
    return null;
  }
}

/** El nombre no puede llevar «·»: es el separador del marcador. */
export function nombreDeAdjunto(nombre: string): string {
  return nombre.replace(/·/g, '-');
}

/** Marcador de una imagen suelta, el mismo que emite el uploader de la web. */
export function marcadorAdjunto(nombre: string, id: string): string {
  return `[adjunto: ${nombreDeAdjunto(nombre)} · ${id}]`;
}

/** Extensión para un mime de imagen (el proveedor no siempre da nombre de archivo). */
export function extensionDe(mime: string): string {
  const m = mime.toLowerCase();
  return m.includes('png') ? 'png' : m.includes('webp') ? 'webp' : m.includes('heic') ? 'heic' : 'jpg';
}
