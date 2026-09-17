import Foundation
import Testing
@testable import CEPITelemedicina

/// En la web, cualquier fallo de `/me` al recargar o al cambiar de organización pintaba el
/// login con la sesión todavía válida; la gente volvía a entrar con Google hasta agotar el
/// rate-limit. Estos tests fijan que la app no lo repite: solo un 401 cierra la sesión.
@MainActor
struct SesionTests {
    private static let usuarioJSON = """
        {"id":"u1","name":"Dra. Pérez","email":"p@cepi.ec","role":"medico_primario","permissions":[],
         "org_id":"%@","orgs":[{"id":"o1","slug":"cepi","name":"CEPI"},{"id":"o2","slug":"cepi-testing","name":"CEPI Testing"}]}
        """

    private static func me(token: String, org: String = "o1") -> ServidorFalso.Respuesta {
        .http(200, #"{"ok":true,"token":"\#(token)","user":"# + String(format: usuarioJSON, org) + "}")
    }

    @Test(arguments: [500, 502, 429])
    func unFalloDelServidorAlAbrirNoMandaAlLogin(status: Int) async {
        let prueba = await Prueba(token: "vigente")
        prueba.servidor.fijar("GET /api/auth/me", .http(status, #"{"ok":false,"error":"Demasiados intentos"}"#))

        await prueba.sesion.restaurar()

        #expect(prueba.servidor.pedidos == ["GET /api/auth/me"])
        #expect(prueba.sesion.estado.sinValidar)
        #expect(await prueba.credenciales.token() == "vigente")
        await prueba.cerrar()
    }

    @Test func sinRedAlAbrirTampocoMandaAlLogin() async {
        let prueba = await Prueba(token: "vigente")
        prueba.servidor.fijar("GET /api/auth/me", .sinRed)

        await prueba.sesion.restaurar()

        #expect(prueba.sesion.estado.sinValidar)
        #expect(await prueba.credenciales.token() == "vigente")
        await prueba.cerrar()
    }

    /// En un teléfono real, un POST sobre una conexión que el servidor cerró por inactividad
    /// falla con `networkConnectionLost`: se reintenta una vez y el usuario no ve nada.
    @Test func unaConexionPerdidaSeReintentaUnaVez() async {
        let prueba = await Prueba(token: "vigente")
        prueba.servidor.fijar("GET /api/auth/me", .conexionPerdida, Self.me(token: "renovado"))

        await prueba.sesion.restaurar()

        #expect(prueba.servidor.pedidos == ["GET /api/auth/me", "GET /api/auth/me"])
        #expect(prueba.sesion.estado == .activa)
        await prueba.cerrar()
    }

    @Test func sinRedElMensajeLlevaElCodigo() async throws {
        let prueba = await Prueba(token: "vigente")
        prueba.servidor.fijar("GET /api/auth/me", .sinRed)

        await prueba.sesion.restaurar()

        guard case .sinValidar(let mensaje) = prueba.sesion.estado else {
            Issue.record("estado inesperado: \(prueba.sesion.estado)")
            return
        }
        #expect(mensaje.contains("\(URLError.notConnectedToInternet.rawValue)"))
        await prueba.cerrar()
    }

    @Test func soloUn401CierraLaSesion() async {
        let prueba = await Prueba(token: "vencido")
        prueba.servidor.fijar("GET /api/auth/me", .http(401, #"{"ok":false,"error":"Token inválido"}"#))

        await prueba.sesion.restaurar()

        #expect(prueba.sesion.estado == .sinSesion)
        #expect(await prueba.credenciales.token() == nil)
        await prueba.cerrar()
    }

    @Test func cambiarDeOrganizacionNoPasaPorElLogin() async throws {
        let prueba = await Prueba(token: "t0")
        prueba.servidor.fijar("GET /api/auth/me", Self.me(token: "t1"), Self.me(token: "t3", org: "o2"))
        prueba.servidor.fijar("POST /api/orgs/switch", .http(200, #"{"ok":true,"token":"t2"}"#))
        await prueba.sesion.restaurar()

        try await prueba.sesion.cambiarOrganizacion(a: "o2")

        #expect(prueba.sesion.estado == .activa)
        #expect(prueba.sesion.usuario?.orgActiva == "o2")
        #expect(await prueba.credenciales.token() == "t3")
        #expect(prueba.servidor.pedidos.allSatisfy { !$0.contains("/api/auth/login") && !$0.contains("/api/auth/google") })
        await prueba.cerrar()
    }

    @Test func eliminarLaCuentaMandaLaConfirmacionYCierraLaSesion() async throws {
        let prueba = await Prueba(token: "t0")
        prueba.servidor.fijar("GET /api/auth/me", Self.me(token: "t1"))
        prueba.servidor.fijar("DELETE /api/auth/me", .http(200, #"{"ok":true}"#))
        await prueba.sesion.restaurar()

        try await prueba.sesion.eliminarCuenta()

        #expect(prueba.servidor.pedidos.last == "DELETE /api/auth/me")
        let cuerpo = try #require(prueba.servidor.cuerpo(de: "DELETE /api/auth/me"))
        #expect(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Bool] == ["confirm": true])
        #expect(prueba.sesion.estado == .sinSesion)
        #expect(prueba.sesion.usuario == nil)
        #expect(await prueba.credenciales.token() == nil)
        await prueba.cerrar()
    }

    /// Cuerpos reales del backend: si no se borró, la sesión sigue y el motivo llega a la
    /// pantalla tal cual.
    @Test(arguments: [
        (409, #"{"ok":false,"error":"Es la única cuenta de administrador activa. Asigne otro administrador antes de eliminarla."}"#),
        (400, #"{"ok":false,"error":"Falta la confirmación: enviar { \"confirm\": true }."}"#),
        (500, #"{"ok":false,"error":"Internal server error"}"#),
    ])
    func siNoSeBorraLaSesionSigueAbierta(status: Int, cuerpo: String) async throws {
        let prueba = await Prueba(token: "t0")
        prueba.servidor.fijar("GET /api/auth/me", Self.me(token: "t1"))
        prueba.servidor.fijar("DELETE /api/auth/me", .http(status, cuerpo))
        await prueba.sesion.restaurar()

        let fallo = await #expect(throws: APIError.self) { try await prueba.sesion.eliminarCuenta() }

        let motivo = try JSONDecoder().decode([String: JSONValor].self, from: Data(cuerpo.utf8))["error"]?.texto
        #expect(fallo?.status == status)
        #expect(fallo?.mensaje == motivo)
        #expect(prueba.sesion.estado == .activa)
        #expect(await prueba.credenciales.token() == "t1")
        await prueba.cerrar()
    }

    @Test func sinRedTampocoSeCierraLaSesionAlEliminar() async {
        let prueba = await Prueba(token: "t0")
        prueba.servidor.fijar("GET /api/auth/me", Self.me(token: "t1"))
        prueba.servidor.fijar("DELETE /api/auth/me", .sinRed)
        await prueba.sesion.restaurar()

        let fallo = await #expect(throws: APIError.self) { try await prueba.sesion.eliminarCuenta() }

        #expect(fallo?.sinRed == true)
        #expect(prueba.sesion.estado == .activa)
        #expect(await prueba.credenciales.token() == "t1")
        await prueba.cerrar()
    }

    @Test func siFallaLaRenovacionTrasCambiarDeOrgSeSigueTrabajando() async throws {
        let prueba = await Prueba(token: "t0")
        prueba.servidor.fijar("GET /api/auth/me", Self.me(token: "t1"), .http(500, #"{"ok":false,"error":"Internal server error"}"#))
        prueba.servidor.fijar("POST /api/orgs/switch", .http(200, #"{"ok":true,"token":"t2"}"#))
        await prueba.sesion.restaurar()

        try await prueba.sesion.cambiarOrganizacion(a: "o2")

        #expect(prueba.sesion.estado == .activa)
        #expect(await prueba.credenciales.token() == "t2")
        await prueba.cerrar()
    }
}

private extension Sesion.Estado {
    var sinValidar: Bool {
        if case .sinValidar = self { return true }
        return false
    }
}

/// Una sesión con su propio Keychain (cuenta de un solo uso) y su propio servidor falso.
@MainActor
private struct Prueba {
    let servidor = ServidorFalso()
    let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
    let sesion: Sesion

    init(token: String) async {
        await credenciales.guardar(token)
        let base = URL(string: "https://\(servidor.host)")!
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        sesion = Sesion(credenciales: credenciales, base: base, baseBot: base, red: red)
    }

    func cerrar() async {
        await credenciales.guardar(nil)
        servidor.retirar()
    }
}

/// Respuestas en cola por "MÉTODO /ruta"; la última se repite. Cada test usa un host propio,
/// así los tests en paralelo no se pisan.
final class ServidorFalso: @unchecked Sendable {
    enum Respuesta {
        case http(Int, String)
        case sinRed
        case conexionPerdida
    }

    let host = "prueba-\(UUID().uuidString.lowercased()).local"
    private let candado = NSLock()
    private var colas: [String: [Respuesta]] = [:]
    private var registro: [String] = []
    private var cuerpos: [String: Data] = [:]

    init() { ProtocoloFalso.registrar(self) }

    var pedidos: [String] { candado.withLock { registro } }

    /// El cuerpo del último pedido a esa clave, si llevaba.
    func cuerpo(de clave: String) -> Data? { candado.withLock { cuerpos[clave] } }

    func fijar(_ clave: String, _ respuestas: Respuesta...) {
        candado.withLock { colas[clave] = respuestas }
    }

    func responder(_ clave: String, cuerpo: Data? = nil) -> Respuesta {
        candado.withLock {
            registro.append(clave)
            if let cuerpo { cuerpos[clave] = cuerpo }
            guard var cola = colas[clave], let primera = cola.first else {
                return .http(404, #"{"ok":false,"error":"sin respuesta fijada"}"#)
            }
            if cola.count > 1 { cola.removeFirst(); colas[clave] = cola }
            return primera
        }
    }

    func retirar() { ProtocoloFalso.retirar(host) }
}

final class ProtocoloFalso: URLProtocol {
    private static let candado = NSLock()
    nonisolated(unsafe) private static var servidores: [String: ServidorFalso] = [:]

    static func registrar(_ servidor: ServidorFalso) {
        candado.withLock { servidores[servidor.host] = servidor }
    }

    static func retirar(_ host: String) {
        _ = candado.withLock { servidores.removeValue(forKey: host) }
    }

    private static func leer(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var datos = Data()
        var bloque = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let leidos = stream.read(&bloque, maxLength: bloque.count)
            guard leidos > 0 else { break }
            datos.append(bloque, count: leidos)
        }
        return datos
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        guard let url = request.url, let host = url.host(),
              let servidor = Self.candado.withLock({ Self.servidores[host] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        // URLSession entrega el cuerpo como stream: `httpBody` llega en nil.
        let cuerpo = request.httpBody ?? request.httpBodyStream.map(Self.leer)
        switch servidor.responder("\(request.httpMethod ?? "GET") \(url.path())", cuerpo: cuerpo) {
        case .sinRed:
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
        case .conexionPerdida:
            client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
        case let .http(status, cuerpo):
            let respuesta = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: respuesta, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(cuerpo.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
}
