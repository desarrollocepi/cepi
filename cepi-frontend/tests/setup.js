// Node 22+ trae un `localStorage` global propio (sin archivo detrás, no funciona) que tapa
// al del DOM simulado. Se pone uno en memoria, igual en cualquier versión de Node, y se
// vacía entre tests para que ninguno herede la sesión de otro.
import { beforeEach } from 'vitest';

class Almacen {
  #datos = new Map();
  get length() { return this.#datos.size; }
  key(i) { return [...this.#datos.keys()][i] ?? null; }
  getItem(k) { return this.#datos.has(String(k)) ? this.#datos.get(String(k)) : null; }
  setItem(k, v) { this.#datos.set(String(k), String(v)); }
  removeItem(k) { this.#datos.delete(String(k)); }
  clear() { this.#datos.clear(); }
}

for (const nombre of ['localStorage', 'sessionStorage']) {
  const almacen = new Almacen();
  Object.defineProperty(globalThis, nombre, { value: almacen, configurable: true, writable: true });
  if (typeof window !== 'undefined' && window !== globalThis) {
    Object.defineProperty(window, nombre, { value: almacen, configurable: true, writable: true });
  }
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
