import Foundation

/// Error de una llamada al backend. `status == 0` es falta de red: la UI distingue "no hay
/// conexión" de "el servidor dijo que no" sin parsear mensajes.
struct APIError: LocalizedError, Sendable {
    let status: Int
    let mensaje: String

    var errorDescription: String? { mensaje }
    var sinRed: Bool { status == 0 }
}

/// Cliente JSON del backend. Espejo de `call()` en `cepi-frontend/src/api.js`: Bearer si
/// hay sesión, `{ok, error}` en los fallos.
///
/// No está atado al hilo principal: la espera de red y el decodificado JSON corren fuera
/// de él, y la UI recibe el resultado ya armado.
final class APIClient: Sendable {
    let base: URL
    private let http: URLSession
    private let credenciales: Credenciales

    init(base: URL, credenciales: Credenciales) {
        self.base = base
        self.credenciales = credenciales
        let configuracion = URLSessionConfiguration.default
        // Un turno del bot espera al LLM: el minuto por defecto se queda corto.
        configuracion.timeoutIntervalForRequest = 120
        configuracion.httpAdditionalHeaders = ["Accept": "application/json"]
        http = URLSession(configuration: configuracion)
    }

    func get<Respuesta: Decodable & Sendable>(
        _ ruta: String, query: [URLQueryItem] = []
    ) async throws -> Respuesta {
        try await enviar("GET", ruta, query: query, cuerpo: nil)
    }

    func post<Respuesta: Decodable & Sendable>(
        _ ruta: String, json: some Encodable & Sendable
    ) async throws -> Respuesta {
        try await enviar("POST", ruta, query: [], cuerpo: try JSONEncoder().encode(json))
    }

    private func enviar<Respuesta: Decodable & Sendable>(
        _ metodo: String, _ ruta: String, query: [URLQueryItem], cuerpo: Data?
    ) async throws -> Respuesta {
        var pedido = URLRequest(url: Self.url(base: base, ruta: ruta, query: query))
        pedido.httpMethod = metodo
        if let cuerpo {
            pedido.httpBody = cuerpo
            pedido.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let token = await credenciales.token()
        if let token {
            pedido.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await http.data(for: pedido)
        } catch {
            throw APIError(status: 0, mensaje: "Sin conexión con el servidor.")
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
        do {
            return try JSONDecoder().decode(Respuesta.self, from: datos)
        } catch {
            throw APIError(status: status, mensaje: "Respuesta inesperada del servidor.")
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
