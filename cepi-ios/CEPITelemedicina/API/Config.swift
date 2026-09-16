import Foundation

enum Config {
    /// Backend (TodoERP). En Debug se puede apuntar a otro sin recompilar con la variable de
    /// entorno `CEPI_API_BASE` (esquema de Xcode, o `SIMCTL_CHILD_CEPI_API_BASE=… xcrun simctl launch`).
    static let apiBase: URL = desdeEntorno("CEPI_API_BASE") ?? URL(string: "https://telemedicina.cepi.ec")!

    /// cepi-bot. En producción nginx lo sirve en el mismo host bajo `/api/bot`; en local corre
    /// aparte (:3002), por eso en Debug se puede separar con `CEPI_BOT_BASE`.
    static let botBase: URL = desdeEntorno("CEPI_BOT_BASE") ?? apiBase

    /// Donde se sirven los documentos de la web (`ficha.html`, `cuerpos.png`). En producción es
    /// el mismo host; en local, un servidor estático sobre `cepi-frontend/public` (`CEPI_WEB_BASE`).
    static let webBase: URL = desdeEntorno("CEPI_WEB_BASE") ?? apiBase

    /// Client ID de Google de tipo **iOS** (proyecto `cepi-500221`). No es secreto: los client
    /// IDs viajan en cada login. `nil` deja el botón de Google gris, con la razón.
    static let googleClientIDiOS: String? = "610463685358-sn7jttlf2e69r0q4dovndpb1qkd3c137.apps.googleusercontent.com"

    private static func desdeEntorno(_ clave: String) -> URL? {
        #if DEBUG
        if let valor = ProcessInfo.processInfo.environment[clave], let url = URL(string: valor) {
            return url
        }
        #endif
        return nil
    }
}
