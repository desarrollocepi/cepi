import AuthenticationServices
import CryptoKit
import UIKit

/// Google Sign-In sin SDK: OAuth 2.0 con PKCE en la hoja de login del sistema
/// (`ASWebAuthenticationSession`). Devuelve el ID token que valida el backend en
/// `/api/auth/google` (PAPER §24.3–24.4). El client ID es de tipo iOS: no tiene secreto.
@MainActor
final class LoginGoogle: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Falla: LocalizedError {
        case cancelado
        case respuestaInvalida
        var errorDescription: String? {
            switch self {
            case .cancelado: "Ingreso con Google cancelado."
            case .respuestaInvalida: "Google no devolvió un token de identidad."
            }
        }
    }

    let clientID: String
    private var sesionActiva: ASWebAuthenticationSession?

    init(clientID: String) {
        self.clientID = clientID
    }

    /// El esquema invertido del client ID: `com.googleusercontent.apps.<prefijo>`.
    var esquema: String {
        "com.googleusercontent.apps." + clientID.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
    }

    var redireccion: String { esquema + ":/oauth2redirect" }

    func idToken() async throws -> String {
        let verificador = Self.aleatorio(bytes: 48)
        let desafio = Self.base64url(Data(SHA256.hash(data: Data(verificador.utf8))))
        let estado = Self.aleatorio(bytes: 16)

        var autorizacion = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        autorizacion.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redireccion),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: desafio),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: estado),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]

        let vuelta = try await autenticar(autorizacion.url!)
        let items = URLComponents(url: vuelta, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == estado,
              let codigo = items.first(where: { $0.name == "code" })?.value else {
            throw Falla.respuestaInvalida
        }
        return try await canjear(codigo: codigo, verificador: verificador)
    }

    private func autenticar(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuacion in
            let sesion = ASWebAuthenticationSession(url: url, callbackURLScheme: esquema) { vuelta, error in
                if let vuelta {
                    continuacion.resume(returning: vuelta)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuacion.resume(throwing: Falla.cancelado)
                } else {
                    continuacion.resume(throwing: error ?? Falla.respuestaInvalida)
                }
            }
            sesion.presentationContextProvider = self
            sesionActiva = sesion
            sesion.start()
        }
    }

    private func canjear(codigo: String, verificador: String) async throws -> String {
        var pedido = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        pedido.httpMethod = "POST"
        pedido.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var cuerpo = URLComponents()
        cuerpo.queryItems = [
            URLQueryItem(name: "code", value: codigo),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redireccion),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code_verifier", value: verificador),
        ]
        pedido.httpBody = Data((cuerpo.percentEncodedQuery ?? "").utf8)
        let (datos, _) = try await URLSession.shared.data(for: pedido)
        guard let token = try? JSONDecoder().decode(RespuestaToken.self, from: datos).idToken else {
            throw Falla.respuestaInvalida
        }
        return token
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }

    static func aleatorio(bytes: Int) -> String {
        var datos = Data(count: bytes)
        _ = datos.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return base64url(datos)
    }

    static func base64url(_ datos: Data) -> String {
        datos.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private struct RespuestaToken: Decodable {
    let idToken: String?
    enum CodingKeys: String, CodingKey { case idToken = "id_token" }
}
