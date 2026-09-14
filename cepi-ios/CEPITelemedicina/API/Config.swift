import Foundation

enum Config {
    /// Backend. En Debug se puede apuntar a otro sin recompilar con la variable de entorno
    /// `CEPI_API_BASE` (esquema de Xcode, o `SIMCTL_CHILD_CEPI_API_BASE=… xcrun simctl launch`).
    static let apiBase: URL = {
        #if DEBUG
        if let valor = ProcessInfo.processInfo.environment["CEPI_API_BASE"],
           let url = URL(string: valor) {
            return url
        }
        #endif
        return URL(string: "https://telemedicina.cepi.ec")!
    }()
}
