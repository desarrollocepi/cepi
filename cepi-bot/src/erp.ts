/**
 * Cliente REST mínimo contra TodoERP, con la identidad del caller.
 *
 * El bot habla con el ERP por MCP cuando el LLM tiene que elegir la herramienta.
 * Para una lectura que el bot ya sabe hacer (la galería), MCP cuesta un proceso
 * hijo por request y, de paso, su envoltorio se queda solo con `data` y pierde el
 * `total` de la página. Acá va directo: mismo backend, mismo JWT, mismos permisos
 * y el mismo filtrado por organización (D-Aux-21) — el ERP no confía en el bot,
 * confía en el token que el bot le reenvía.
 */

export interface ErpAuth {
  jwt?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ErpPagina {
  data: any[];
  /** Solo con `with_total=1`. Cuántas filas matchean, sin limit/offset. */
  total?: number;
}

export interface ErpClient {
  /** GET /api/entities con los parámetros ya aplanados (`filter[x][in]`, `q_fields`, …). */
  listar(params: Record<string, string | number | undefined>): Promise<ErpPagina>;
}

export function erpBaseUrl(): string {
  return process.env.TODOERP_API_URL || 'http://localhost:3001';
}

export function erpClient(auth: ErpAuth): ErpClient {
  const base = (auth.baseUrl || erpBaseUrl()).replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (auth.jwt) headers['Authorization'] = `Bearer ${auth.jwt}`;
  if (auth.apiKey) headers['x-api-key'] = auth.apiKey;

  return {
    async listar(params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        qs.set(k, String(v));
      }
      const res = await fetch(`${base}/api/entities?${qs.toString()}`, { headers });
      const body: any = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) {
        const err: any = new Error(body?.error || `TodoERP HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return { data: Array.isArray(body?.data) ? body.data : [], total: body?.total };
    },
  };
}
