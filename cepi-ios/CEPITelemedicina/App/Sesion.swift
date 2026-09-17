import Foundation
import Observation

/// Estado de la sesión y única puerta de entrada y salida. Espejo de `refresh()` y
/// `onLogout()` en `App.vue`.
///
/// Solo un 401 manda al login. Si un fallo pasajero de `/me` (recarga, cambio de org, 5xx,
/// 429) mostrara el login, la gente vuelve a entrar con Google una y otra vez hasta agotar
/// el rate-limit de `/auth/google`: pasó en la web. `SesionTests` lo fija.
@MainActor
@Observable
final class Sesion {
    enum Estado: Equatable {
        case cargando
        case sinSesion
        /// Cuenta activa pero todavía sin rol clínico (`role = 'pendiente'`).
        case pendiente
        case activa
        /// Hay token pero no se pudo validar (sin red, servidor caído). No es motivo para
        /// cerrar la sesión: se reintenta.
        case sinValidar(String)
    }

    private(set) var estado: Estado = .cargando
    private(set) var usuario: Usuario?

    let api: CEPIAPI
    @ObservationIgnored private let credenciales: Credenciales
    @ObservationIgnored private var ultimaRenovacion: Date = .distantPast
    @ObservationIgnored private var escucha: Task<Void, Never>?

    init(
        credenciales: Credenciales = .compartidas, base: URL = Config.apiBase, baseBot: URL = Config.botBase,
        red: URLSessionConfiguration = .default
    ) {
        self.credenciales = credenciales
        api = CEPIAPI(cliente: APIClient(base: base, baseBot: baseBot, credenciales: credenciales, configuracion: red))
        escucha = Task { [weak self, credenciales] in
            for await _ in credenciales.expiraciones {
                self?.cerrarLocal()
            }
        }
    }

    /// Al abrir la app: si hay token guardado, validarlo y traer el usuario.
    func restaurar() async {
        guard await credenciales.token() != nil else {
            estado = .sinSesion
            return
        }
        await renovar()
    }

    /// Sesión deslizante: `/me` reemite el JWT (8 h). Se llama al abrir y al volver a primer
    /// plano, así quien usa la app a diario no vuelve a ver el login.
    func renovar() async {
        do {
            let respuesta = try await api.yo()
            await credenciales.guardar(respuesta.token)
            ultimaRenovacion = .now
            aplicar(respuesta.user)
        } catch let error as APIError where error.status == 401 {
            cerrarLocal()
        } catch {
            // Con el usuario ya cargado, un fallo al renovar no interrumpe el trabajo: se
            // reintenta la próxima vez que la app vuelva a primer plano.
            if usuario == nil, !Task.isCancelled { estado = .sinValidar(error.localizedDescription) }
        }
    }

    func renovarSiHaceFalta() async {
        guard usuario != nil, Date.now.timeIntervalSince(ultimaRenovacion) > 30 * 60 else { return }
        await renovar()
    }

    func entrar(email: String, password: String) async throws {
        let respuesta = try await api.login(
            email: email.trimmingCharacters(in: .whitespaces).lowercased(),
            password: password
        )
        await credenciales.guardar(respuesta.token)
        await renovar()
    }

    func entrarConGoogle(idToken: String) async throws {
        let respuesta = try await api.loginGoogle(idToken: idToken)
        await credenciales.guardar(respuesta.token)
        await renovar()
    }

    /// La org activa viaja en el JWT: cambiarla reemite el token, y lo que depende de la org
    /// (la lista de pacientes) se recarga al ver el `orgActiva` nuevo.
    func cambiarOrganizacion(a id: String) async throws {
        guard id != usuario?.orgActiva else { return }
        let respuesta = try await api.cambiarOrganizacion(id)
        if let token = respuesta.token { await credenciales.guardar(token) }
        await renovar()
    }

    func salir() async {
        await credenciales.guardar(nil)
        cerrarLocal()
    }

    /// La sesión se cierra solo si el servidor confirmó el borrado. Si falla (último
    /// administrador, sin red, 5xx) la sesión sigue abierta y el error sube a la pantalla.
    func eliminarCuenta() async throws {
        try await api.eliminarCuenta()
        await salir()
    }

    private func aplicar(_ usuario: Usuario) {
        self.usuario = usuario
        estado = usuario.role == "pendiente" ? .pendiente : .activa
    }

    private func cerrarLocal() {
        usuario = nil
        estado = .sinSesion
    }
}
