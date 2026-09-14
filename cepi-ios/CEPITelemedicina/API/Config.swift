import Foundation

enum Config {
    /// Backend (TodoERP). En Debug se puede apuntar a otro sin recompilar con la variable de
    /// entorno `CEPI_API_BASE` (esquema de Xcode, o `SIMCTL_CHILD_CEPI_API_BASE=… xcrun simctl launch`).
    static let apiBase: URL = desdeEntorno("CEPI_API_BASE") ?? URL(string: "https://telemedicina.cepi.ec")!

    /// cepi-bot. En producción nginx lo sirve en el mismo host bajo `/api/bot`; en local corre
    /// aparte (:3002), por eso en Debug se puede separar con `CEPI_BOT_BASE`.
    static let botBase: URL = desdeEntorno("CEPI_BOT_BASE") ?? apiBase

    private static func desdeEntorno(_ clave: String) -> URL? {
        #if DEBUG
        if let valor = ProcessInfo.processInfo.environment[clave], let url = URL(string: valor) {
            return url
        }
        #endif
        return nil
    }
}
