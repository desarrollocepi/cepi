import Foundation
import OSLog

/// Error de una llamada al backend. `status == 0` es falta de red y `-1` una respuesta que no
/// se pudo leer: la UI distingue "no hay conexión" de "el servidor dijo que no" sin parsear
/// mensajes.
struct APIError: LocalizedError, Sendable {
    let status: Int
    let mensaje: String

    var errorDescription: String? { mensaje }
    var sinRed: Bool { status == 0 }
}

/// Cliente del backend. Espejo de `call()` en `cepi-frontend/src/api.js`: Bearer si hay
/// sesión, `{ok, error}` en los fallos.
///
/// No está atado al hilo principal: la espera de red y el decodificado JSON corren fuera
/// de él, y la UI recibe el resultado ya armado.
final class APIClient: Sendable {
    let base: URL
    /// A dónde van las rutas `/api/bot/*` (cepi-bot). En producción es el mismo host.
    let baseBot: URL
    private let http: URLSession
    private let credenciales: Credenciales

    /// `configuracion` solo cambia en los tests, para responder sin backend.
    init(
        base: URL, baseBot: URL? = nil, credenciales: Credenciales,
        configuracion: URLSessionConfiguration = .default
    ) {
        self.base = base
        self.baseBot = baseBot ?? base
        self.credenciales = credenciales
        // Un turno del bot espera al LLM: el minuto por defecto se queda corto.
        configuracion.timeoutIntervalForRequest = 120
        configuracion.httpAdditionalHeaders = ["Accept": "application/json"]
        http = URLSession(configuration: configuracion)
    }

    func get<Respuesta: Decodable & Sendable>(
        _ ruta: String, query: [URLQueryItem] = []
    ) async throws -> Respuesta {
        try decodificar(try await ejecutar("GET", ruta, query: query))
    }

    func post<Respuesta: Decodable & Sendable>(
        _ ruta: String, json: some Encodable & Sendable
    ) async throws -> Respuesta {
        let cuerpo = try JSONEncoder().encode(json)
        return try decodificar(try await ejecutar("POST", ruta, cuerpo: cuerpo, tipo: "application/json"))
    }

    /// DELETE con cuerpo JSON: el borrado de cuenta viaja con su confirmación explícita.
    func delete<Respuesta: Decodable & Sendable>(
        _ ruta: String, json: some Encodable & Sendable
    ) async throws -> Respuesta {
        let cuerpo = try JSONEncoder().encode(json)
        return try decodificar(try await ejecutar("DELETE", ruta, cuerpo: cuerpo, tipo: "application/json"))
    }

    /// DELETE sin cuerpo (borrado de un registro).
    func delete<Respuesta: Decodable & Sendable>(_ ruta: String) async throws -> Respuesta {
        try decodificar(try await ejecutar("DELETE", ruta))
    }

    /// Un binario autenticado (`/api/attachments/:id/file`). Las imágenes clínicas no se
    /// pueden pedir con `AsyncImage`: no manda el header `Authorization`.
    func datos(_ ruta: String) async throws -> Data {
        try await ejecutar("GET", ruta)
    }

    /// Sube un archivo como `multipart/form-data` en el campo `file`, igual que
    /// `uploadAttachment` en la web.
    func subir<Respuesta: Decodable & Sendable>(
        _ ruta: String, archivo: Data, nombre: String, mime: String
    ) async throws -> Respuesta {
        let limite = "cepi-\(UUID().uuidString)"
        let nombreSeguro = nombre.replacingOccurrences(of: "\"", with: "'")
        var cuerpo = Data()
        cuerpo.append(Data("--\(limite)\r\n".utf8))
        cuerpo.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(nombreSeguro)\"\r\n".utf8))
        cuerpo.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
        cuerpo.append(archivo)
        cuerpo.append(Data("\r\n--\(limite)--\r\n".utf8))
        return try decodificar(try await ejecutar(
            "POST", ruta, cuerpo: cuerpo, tipo: "multipart/form-data; boundary=\(limite)"
        ))
    }

    /// La URL final de una ruta: las de cepi-bot van a su host.
    func url(para ruta: String, query: [URLQueryItem] = []) -> URL {
        Self.url(base: ruta.hasPrefix("/api/bot") ? baseBot : base, ruta: ruta, query: query)
    }

    private func ejecutar(
        _ metodo: String, _ ruta: String, query: [URLQueryItem] = [], cuerpo: Data? = nil, tipo: String? = nil
    ) async throws -> Data {
        var pedido = URLRequest(url: url(para: ruta, query: query))
        pedido.httpMethod = metodo
        if let cuerpo {
            pedido.httpBody = cuerpo
            pedido.setValue(tipo, forHTTPHeaderField: "Content-Type")
        }
        let token = await credenciales.token()
        if let token {
            pedido.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await pedirConReintento(pedido)
        } catch {
            // El código de URLError queda en el mensaje y en el log: "sin conexión" cubre
            // desde un teléfono sin red hasta un TLS roto, y sin el código no se distinguen.
            let codigo = (error as? URLError)?.code.rawValue ?? 0
            if (error as? URLError)?.code != .cancelled {
                Self.registro.error("\(metodo, privacy: .public) \(ruta, privacy: .public) falló en la red: \(codigo)")
            }
            throw APIError(status: 0, mensaje: "Sin conexión con el servidor (código \(codigo)).")
        }
        let status = (respuesta as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            // 401 = token vencido o inválido (authMiddleware.ts). Un 403 es falta de
            // permiso y no toca la sesión.
            if status == 401, let token {
                await credenciales.expirar(tokenRechazado: token)
            }
            let mensaje = (try? JSONDecoder().decode(CuerpoError.self, from: datos))?.error
            throw APIError(status: status, mensaje: mensaje ?? "Error del servidor (HTTP \(status)).")
        }
        return datos
    }

    private static let registro = Logger(subsystem: "ec.cepi.telemedicina", category: "red")

    /// Un reintento cuando se cae la conexión (`networkConnectionLost`). En un teléfono real
    /// pasa al reusar una conexión que el servidor ya cerró por inactividad: URLSession
    /// reintenta solo los GET, así que un POST como "activar paciente" fallaba a la primera.
    private func pedirConReintento(_ pedido: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await http.data(for: pedido)
        } catch let error as URLError where error.code == .networkConnectionLost {
            return try await http.data(for: pedido)
        }
    }

    private func decodificar<Respuesta: Decodable>(_ datos: Data) throws -> Respuesta {
        do {
            return try JSONDecoder().decode(Respuesta.self, from: datos)
        } catch {
            throw APIError(status: -1, mensaje: "Respuesta inesperada del servidor.")
        }
    }

    /// Arma la URL. El `+` se codifica a mano: `URLComponents` lo deja literal y Express lo
    /// lee como espacio, así que buscar "a+b" buscaría "a b".
    static func url(base: URL, ruta: String, query: [URLQueryItem]) -> URL {
        var partes = URLComponents(url: base.appending(path: ruta), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            partes.queryItems = query
            partes.percentEncodedQuery = partes.percentEncodedQuery?
                .replacingOccurrences(of: "+", with: "%2B")
        }
        return partes.url!
    }
}

private struct CuerpoError: Decodable {
    let error: String?
}
