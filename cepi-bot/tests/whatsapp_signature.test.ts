import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature } from '../src/whatsapp.js';

const secret = 'app-secret-de-prueba';
const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
const firma = (b: Buffer, s = secret) =>
  'sha256=' + createHmac('sha256', s).update(b).digest('hex');

describe('verifyMetaSignature', () => {
  it('acepta la firma de Meta sobre el cuerpo crudo', () => {
    expect(verifyMetaSignature(body, firma(body), secret)).toBe(true);
  });

  it('rechaza un cuerpo alterado', () => {
    const otro = Buffer.from(body.toString().replace('[]', '[{}]'));
    expect(verifyMetaSignature(otro, firma(body), secret)).toBe(false);
  });

  it('rechaza una firma hecha con otro secreto', () => {
    expect(verifyMetaSignature(body, firma(body, 'otro'), secret)).toBe(false);
  });

  it('falla cerrado sin secreto, sin cabecera o con cabecera mal formada', () => {
    expect(verifyMetaSignature(body, firma(body), undefined)).toBe(false);
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', secret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zz', secret)).toBe(false);
    expect(verifyMetaSignature(undefined, firma(body), secret)).toBe(false);
  });
});
