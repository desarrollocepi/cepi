import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({ fetchAttachmentObjectUrl: vi.fn() }));
import { fetchAttachmentObjectUrl } from '../src/api.js';
import MessageContent from '../src/components/MessageContent.vue';

const ID1 = '11111111-2222-3333-4444-555555555555';
const ID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
async function montar(content) {
  const w = mount(MessageContent, { props: { content }, global: { stubs: { teleport: true } } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  fetchAttachmentObjectUrl.mockImplementation(async (url) => 'blob:' + url.split('/')[3]);
});

describe('MessageContent', () => {
  it('texto plano: un solo segmento, sin pedir nada', async () => {
    const w = await montar('Hola\ndoctor');
    expect(w.findAll('.seg-text')).toHaveLength(1);
    expect(w.find('.seg-text').text()).toBe('Hola\ndoctor');
    expect(fetchAttachmentObjectUrl).not.toHaveBeenCalled();
  });

  it('[img:<uuid>] se vuelve una miniatura, con el texto de antes y de después', async () => {
    const w = await montar(`Lesión:\n[img:${ID1}]\nResultado: nevus`);
    expect(w.findAll('.seg-text').map((s) => s.text())).toEqual(['Lesión:', 'Resultado: nevus']);
    expect(fetchAttachmentObjectUrl).toHaveBeenCalledWith(`/api/attachments/${ID1}/file`);
    expect(w.find('.seg-img').attributes('src')).toBe('blob:' + ID1);
  });

  it('[adjunto: nombre · uuid] también, y el nombre es el alt', async () => {
    const w = await montar(`mirar esto\n[adjunto: foto 1.jpg · ${ID2.toUpperCase()}]`);
    expect(fetchAttachmentObjectUrl).toHaveBeenCalledWith(`/api/attachments/${ID2}/file`);
    expect(w.find('.seg-img').attributes('alt')).toBe('foto 1.jpg');
  });

  it('varias imágenes en un mismo mensaje', async () => {
    const w = await montar(`[img:${ID1}] y [img:${ID2}]`);
    expect(w.findAll('.seg-img')).toHaveLength(2);
  });

  it('mientras no llega (o si falla) dice "cargando imagen…"', async () => {
    fetchAttachmentObjectUrl.mockRejectedValue(new Error('HTTP 404'));
    const w = await montar(`[img:${ID1}]`);
    expect(w.find('.seg-img').exists()).toBe(false);
    expect(w.find('.seg-loading').text()).toContain('cargando imagen');
  });

  it('tocar la miniatura abre el visor con esa imagen y cerrar lo quita', async () => {
    const w = await montar(`[img:${ID1}]`);
    expect(w.find('.lightbox').exists()).toBe(false);
    await w.find('.seg-img').trigger('click');
    expect(w.find('.lb-img').attributes('src')).toBe('blob:' + ID1);
    await w.find('.lb-close').trigger('click');
    expect(w.find('.lightbox').exists()).toBe(false);
  });

  it('al cambiar el contenido carga las imágenes nuevas sin volver a pedir las que ya tiene', async () => {
    const w = await montar(`[img:${ID1}]`);
    await w.setProps({ content: `[img:${ID1}] [img:${ID2}]` });
    await flushPromises();
    expect(fetchAttachmentObjectUrl).toHaveBeenCalledTimes(2);
  });

  it('al desmontarse libera los blobs', async () => {
    const revocar = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const w = await montar(`[img:${ID1}]`);
    w.unmount();
    expect(revocar).toHaveBeenCalledWith('blob:' + ID1);
  });
});
