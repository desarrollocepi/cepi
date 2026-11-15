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
        /// Con sesión pero sin aceptar la versión vigente de los términos (PAPER §37).
        case terms
        case activa
        /// Hay token pero no se pudo validar (sin red, servidor caído). No es motivo para
        /// cerrar la sesión: se reintenta.
        case sinValidar(String)
    }

    private(set) var estado: Estado = .cargando
    private(set) var usuario: Usuario?
    /// Mientras se cambia de org: la lista muestra la espera en vez de la org anterior.
    private(set) var cambiandoOrganizacion = false
    /// Versión vigente de los términos (PAPER §37). La dice el servidor (`terminos.json`), no
    /// la app: si cambia, se vuelve a pedir sin publicar otra versión. Se relee en cada `renovar()`.
    private(set) var currentTermsVersion = fallbackTermsVersion

    let api: CEPIAPI
    @ObservationIgnored private let credenciales: Credenciales
    @ObservationIgnored private var ultimaRenovacion: Date = .distantPast
    @ObservationIgnored private var escucha: Task<Void, Never>?
    @ObservationIgnored private let termsVersionSource: @Sendable () async -> String?

    init(
        credenciales: Credenciales = .compartidas, base: URL = Config.apiBase, baseBot: URL = Config.botBase,
        red: URLSessionConfiguration = .default,
        termsVersionSource: @escaping @Sendable () async -> String? = { await fetchCurrentTermsVersion(web: Config.webBase) }
    ) {
        self.credenciales = credenciales
        self.termsVersionSource = termsVersionSource
        api = CEPIAPI(cliente: APIClient(base: base, baseBot: baseBot, credenciales: credenciales, configuracion: red))
        escucha = Task { [weak self, credenciales] in
            for await _ in credenciales.expiraciones {
                self?.cerrarLocal()
            }
        }
    }

    /// Al abrir la app: si hay token guardado, validarlo y traer el usuario.
    func restaurar() async {
        #if DEBUG
        // Solo Debug: con `CEPI_DEV_EMAIL` se entra siempre con esa cuenta. Sin esto, una
        // sesión que quedó en el Keychain del simulador (otra cuenta, o una pendiente) gana
        // y el ingreso automático de LoginView nunca corre.
        if ProcessInfo.processInfo.environment["CEPI_DEV_EMAIL"] != nil {
            await credenciales.guardar(nil)
        }
        #endif
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
            if let version = await termsVersionSource() { currentTermsVersion = version }
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
        cambiandoOrganizacion = true
        defer { cambiandoOrganizacion = false }
        let respuesta = try await api.cambiarOrganizacion(id)
        if let token = respuesta.token { await credenciales.guardar(token) }
        await renovar()
    }

    /// «Acepto» en la pantalla de términos. Si falla, el error sube a la pantalla.
    func acceptTerms() async throws {
        let respuesta = try await api.acceptTerms(version: currentTermsVersion)
        await credenciales.guardar(respuesta.token)
        aplicar(respuesta.user)
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
        if usuario.termsVersion != currentTermsVersion {
            estado = .terms
        } else {
            estado = usuario.role == "pendiente" ? .pendiente : .activa
        }
    }

    private func cerrarLocal() {
        usuario = nil
        estado = .sinSesion
    }
}
