// Las pantallas de cuenta: ingreso, registro, verificación, cuenta pendiente, perfil y
// borrado de la cuenta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../src/api.js', () => ({
  login: vi.fn(), googleLogin: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(),
  resendVerifyCode: vi.fn(), deleteAccount: vi.fn(), updateProfile: vi.fn(),
}));
import * as api from '../src/api.js';
import Login from '../src/components/Login.vue';
import Register from '../src/components/Register.vue';
import VerifyEmail from '../src/components/VerifyEmail.vue';
import PendingApproval from '../src/components/PendingApproval.vue';
import EliminarCuenta from '../src/components/EliminarCuenta.vue';
import Profile from '../src/components/Profile.vue';

const Google = { name: 'GoogleSignIn', template: '<button class="g" @click="$emit(\'credential\', \'cred-1\')">Google</button>' };

describe('Login', () => {
  const montar = () => mount(Login, { global: { stubs: { GoogleSignIn: Google } } });

  it('con email y contraseña entra y avisa', async () => {
    api.login.mockResolvedValue({ token: 't' });
    const w = montar();
    await w.find('input[type="email"]').setValue('a@cepi.ec');
    await w.find('input[type="password"]').setValue('clave');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(api.login).toHaveBeenCalledWith('a@cepi.ec', 'clave');
    expect(w.emitted('logged-in')).toHaveLength(1);
  });

  it('un error se muestra y no entra; el botón vuelve a habilitarse', async () => {
    api.login.mockRejectedValue(new Error('Credenciales inválidas'));
    const w = montar();
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('.error').text()).toBe('Credenciales inválidas');
    expect(w.emitted('logged-in')).toBeUndefined();
    expect(w.find('button[type="submit"]').element.disabled).toBe(false);
  });

  it('mientras ingresa el botón queda deshabilitado', async () => {
    api.login.mockReturnValue(new Promise(() => {}));
    const w = montar();
    await w.find('form').trigger('submit');
    expect(w.find('button[type="submit"]').element.disabled).toBe(true);
    expect(w.find('button[type="submit"]').text()).toBe('Ingresando…');
  });

  it('con Google manda la credencial y entra; si falla lo dice', async () => {
    api.googleLogin.mockResolvedValue({ token: 't' });
    const w = montar();
    await w.find('.g').trigger('click');
    await flushPromises();
    expect(api.googleLogin).toHaveBeenCalledWith('cred-1');
    expect(w.emitted('logged-in')).toHaveLength(1);
    api.googleLogin.mockRejectedValue(new Error('Cuenta no autorizada'));
    await w.find('.g').trigger('click');
    await flushPromises();
    expect(w.find('.error').text()).toBe('Cuenta no autorizada');
    expect(w.emitted('logged-in')).toHaveLength(1);
  });

  it('"Crear cuenta" lleva al registro', async () => {
    const w = montar();
    await w.find('.hint a').trigger('click');
    expect(w.emitted('go-register')).toHaveLength(1);
  });
});

describe('Register', () => {
  it('manda los datos y pasa a la verificación con el email en minúsculas', async () => {
    api.register.mockResolvedValue({});
    const w = mount(Register);
    const [nombre, email, tel, cedula, clave] = w.findAll('input');
    await nombre.setValue(' Ana Pérez ');
    await email.setValue('Ana@Cepi.EC');
    await tel.setValue('099');
    await cedula.setValue('0101');
    await clave.setValue('secreta123');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(api.register).toHaveBeenCalledWith({ name: 'Ana Pérez', email: 'Ana@Cepi.EC', password: 'secreta123', phone: '099', cedula: '0101' });
    expect(w.emitted('registered')[0]).toEqual(['ana@cepi.ec']);
  });

  it('el error del backend se muestra y no avanza', async () => {
    api.register.mockRejectedValue(new Error('El email ya existe'));
    const w = mount(Register);
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('.error').text()).toBe('El email ya existe');
    expect(w.emitted('registered')).toBeUndefined();
  });

  it('se puede volver al ingreso', async () => {
    const w = mount(Register);
    await w.find('.hint a').trigger('click');
    expect(w.emitted('go-login')).toHaveLength(1);
  });
});

describe('VerifyEmail', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const montar = () => mount(VerifyEmail, { props: { email: 'a@cepi.ec' } });
  const verificar = (w) => w.findAll('button').find((b) => b.text().includes('Verific'));

  it('solo acepta dígitos, hasta 6, y Verificar se habilita con los 6', async () => {
    const w = montar();
    const campo = w.find('.code-input');
    expect(verificar(w).element.disabled).toBe(true);
    await campo.setValue('12a3');
    expect(campo.element.value).toBe('123');
    expect(verificar(w).element.disabled).toBe(true);
    await campo.setValue('1234567');
    expect(campo.element.value).toBe('123456');
    expect(verificar(w).element.disabled).toBe(false);
  });

  it('código correcto: avisa y pasa al ingreso', async () => {
    api.verifyEmail.mockResolvedValue({});
    const w = montar();
    await w.find('.code-input').setValue('123456');
    await verificar(w).trigger('click');
    await flushPromises();
    expect(api.verifyEmail).toHaveBeenCalledWith('a@cepi.ec', '123456');
    expect(w.find('.ok').text()).toContain('verificada');
    expect(w.emitted('done')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1200);
    expect(w.emitted('done')).toHaveLength(1);
  });

  it('código incorrecto: un solo mensaje genérico, diga lo que diga el backend', async () => {
    api.verifyEmail.mockRejectedValue(new Error('usuario inexistente'));
    const w = montar();
    await w.find('.code-input').setValue('000000');
    await verificar(w).trigger('click');
    await flushPromises();
    expect(w.find('.error').text()).toContain('Código incorrecto o vencido');
    expect(w.find('.error').text()).not.toContain('inexistente');
  });

  it('reenviar limpia el código, y si falla no revela si el correo existe', async () => {
    api.resendVerifyCode.mockResolvedValue({});
    const w = montar();
    await w.find('.code-input').setValue('123456');
    await w.findAll('.hint a')[0].trigger('click');
    await flushPromises();
    expect(api.resendVerifyCode).toHaveBeenCalledWith('a@cepi.ec');
    expect(w.find('.code-input').element.value).toBe('');
    api.resendVerifyCode.mockRejectedValue(new Error('no existe'));
    await w.findAll('.hint a')[0].trigger('click');
    await flushPromises();
    expect(w.find('.ok').text()).toBe('Si el correo es válido, te reenviamos el código.');
  });
});

describe('EliminarCuenta', () => {
  const si = (w) => w.find('.del-si');

  it('pide confirmación antes de borrar y explica qué se conserva', async () => {
    const w = mount(EliminarCuenta);
    expect(w.find('.del-confirm').exists()).toBe(false);
    await w.find('.del-btn').trigger('click');
    expect(api.deleteAccount).not.toHaveBeenCalled();
    expect(w.find('.del-confirm').text()).toContain('no se borran');
    expect(w.find('.del-btn').element.disabled).toBe(true);
    expect(w.find('.del-btn').attributes('title')).toBe('Confirma o cancela abajo');
  });

  it('cancelar cierra sin borrar', async () => {
    const w = mount(EliminarCuenta);
    await w.find('.del-btn').trigger('click');
    await w.find('.del-cancelar').trigger('click');
    expect(w.find('.del-confirm').exists()).toBe(false);
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('confirmar borra y avisa al padre', async () => {
    api.deleteAccount.mockResolvedValue({});
    const w = mount(EliminarCuenta);
    await w.find('.del-btn').trigger('click');
    await si(w).trigger('click');
    await flushPromises();
    expect(api.deleteAccount).toHaveBeenCalledTimes(1);
    expect(w.emitted('eliminada')).toHaveLength(1);
  });

  it('si falla (último administrador, sin red) lo dice y la sesión sigue', async () => {
    api.deleteAccount.mockRejectedValue(new Error('Eres el último administrador'));
    const w = mount(EliminarCuenta);
    await w.find('.del-btn').trigger('click');
    await si(w).trigger('click');
    await flushPromises();
    expect(w.find('.del-err').text()).toBe('Eres el último administrador');
    expect(w.emitted('eliminada')).toBeUndefined();
    expect(si(w).element.disabled).toBe(false);
  });
});

describe('PendingApproval', () => {
  it('deja cerrar sesión y también borrar la cuenta', async () => {
    api.deleteAccount.mockResolvedValue({});
    const w = mount(PendingApproval);
    expect(w.text()).toContain('Cuenta pendiente de aprobación');
    await w.find('button.link').trigger('click');
    expect(w.emitted('logout')).toHaveLength(1);
    await w.find('.del-btn').trigger('click');
    await w.find('.del-si').trigger('click');
    await flushPromises();
    expect(w.emitted('logout')).toHaveLength(2);
  });
});

describe('Profile', () => {
  const USUARIO = { name: 'Ana', email: 'a@cepi.ec', role: 'medico_primario', phone: '099', cedula: '0101' };
  const montar = () => mount(Profile, { props: { user: USUARIO } });
  const campos = (w) => w.findAll('.prof-form input');

  it('carga los datos; el email no se edita y dice por qué', () => {
    const w = montar();
    const [nombre, email, tel, cedula] = campos(w);
    expect(nombre.element.value).toBe('Ana');
    expect(email.element.disabled).toBe(true);
    expect(email.attributes('title')).toContain('no se puede cambiar');
    expect(tel.element.value).toBe('099');
    expect(cedula.element.value).toBe('0101');
    expect(w.find('.prof-hint').text()).toBe('Rol: medico_primario');
  });

  it('guarda nombre, teléfono y cédula, sin contraseña si no se escribió', async () => {
    api.updateProfile.mockResolvedValue({ user: { ...USUARIO, name: 'Ana María' } });
    const w = montar();
    await campos(w)[0].setValue('  Ana María ');
    await w.find('.prof-form').trigger('submit');
    await flushPromises();
    expect(api.updateProfile).toHaveBeenCalledWith({ name: 'Ana María', phone: '099', cedula: '0101' });
    expect(w.find('.prof-ok').text()).toBe('Perfil actualizado.');
    expect(w.emitted('saved')[0][0].name).toBe('Ana María');
  });

  it('nombre vacío no se envía', async () => {
    const w = montar();
    await campos(w)[0].setValue('   ');
    await w.find('.prof-form').trigger('submit');
    expect(w.find('.prof-err').text()).toBe('El nombre no puede estar vacío.');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('cambio de contraseña: valida largo, repetición y la actual antes de enviar', async () => {
    api.updateProfile.mockResolvedValue({ user: USUARIO });
    const w = montar();
    await w.find('.prof-pass-toggle').trigger('click');
    const [actual, nueva, repetir] = w.findAll('.prof-pass-body input');
    const guardar = async () => { await w.find('.prof-form').trigger('submit'); await flushPromises(); };

    await nueva.setValue('corta');
    await guardar();
    expect(w.find('.prof-err').text()).toContain('al menos 8 caracteres');
    await nueva.setValue('larga12345');
    await repetir.setValue('otra');
    await guardar();
    expect(w.find('.prof-err').text()).toBe('Las contraseñas nuevas no coinciden.');
    await repetir.setValue('larga12345');
    await guardar();
    expect(w.find('.prof-err').text()).toContain('contraseña actual');
    expect(api.updateProfile).not.toHaveBeenCalled();

    await actual.setValue('vieja');
    await guardar();
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ current_password: 'vieja', new_password: 'larga12345' }));
    expect(w.find('.prof-pass-body').exists()).toBe(false);   // se cierra y se vacía
  });

  it('el error del backend se muestra', async () => {
    api.updateProfile.mockRejectedValue(new Error('Contraseña actual incorrecta'));
    const w = montar();
    await w.find('.prof-form').trigger('submit');
    await flushPromises();
    expect(w.find('.prof-err').text()).toBe('Contraseña actual incorrecta');
    expect(w.emitted('saved')).toBeUndefined();
  });

  it('volver, cerrar sesión y borrar la cuenta avisan al padre', async () => {
    api.deleteAccount.mockResolvedValue({});
    const w = montar();
    await w.find('.prof-back').trigger('click');
    await w.find('.prof-logout-btn').trigger('click');
    await w.find('.del-btn').trigger('click');
    await w.find('.del-si').trigger('click');
    await flushPromises();
    expect(w.emitted('back')).toHaveLength(1);
    expect(w.emitted('logout')).toHaveLength(2);
  });
});
