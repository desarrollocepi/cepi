import Foundation
import Security

/// El JWT de la sesión. Vive en Keychain y no en `UserDefaults`: abre historias clínicas,
/// y `UserDefaults` es un plist que viaja legible en los backups del dispositivo.
actor Credenciales {
    static let compartidas = Credenciales()

    /// Avisa cuando el backend rechazó el token (401). La sesión la escucha para volver al
    /// login; el cliente HTTP no sabe nada de la UI.
    nonisolated let expiraciones: AsyncStream<Void>
    private let avisar: AsyncStream<Void>.Continuation

    private let cuenta: String
    private var enMemoria: String?
    private var leido = false

    init(cuenta: String = "jwt") {
        let (stream, continuacion) = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
        expiraciones = stream
        avisar = continuacion
        self.cuenta = cuenta
    }

    func token() -> String? {
        if !leido {
            enMemoria = Keychain.leer(cuenta: cuenta)
            leido = true
        }
        return enMemoria
    }

    func guardar(_ token: String?) {
        enMemoria = token
        leido = true
        Keychain.guardar(token, cuenta: cuenta)
    }

    /// Solo si el token rechazado sigue siendo el vigente: el 401 de una llamada que salió
    /// antes de un login nuevo no debe tirar la sesión recién abierta.
    func expirar(tokenRechazado: String) {
        guard tokenRechazado == enMemoria else { return }
        guardar(nil)
        avisar.yield()
    }
}

private enum Keychain {
    static let servicio = "ec.cepi.telemedicina"

    static func leer(cuenta: String) -> String? {
        var consulta = base(cuenta)
        consulta[kSecReturnData as String] = true
        consulta[kSecMatchLimit as String] = kSecMatchLimitOne
        var resultado: CFTypeRef?
        guard SecItemCopyMatching(consulta as CFDictionary, &resultado) == errSecSuccess,
              let datos = resultado as? Data else { return nil }
        return String(data: datos, encoding: .utf8)
    }

    static func guardar(_ valor: String?, cuenta: String) {
        SecItemDelete(base(cuenta) as CFDictionary)
        guard let valor else { return }
        var alta = base(cuenta)
        alta[kSecValueData as String] = Data(valor.utf8)
        // Ni iCloud ni restaurar en otro teléfono: la sesión es de este dispositivo.
        alta[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(alta as CFDictionary, nil)
    }

    private static func base(_ cuenta: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: servicio,
            kSecAttrAccount as String: cuenta,
        ]
    }
}
