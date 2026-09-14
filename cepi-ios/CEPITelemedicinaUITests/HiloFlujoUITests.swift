import XCTest

/// Recorre la app de punta a punta contra el stack local: TodoERP en :3001 y cepi-bot en :3002
/// con los datos ficticios (`scripts/reset-cepi.sh` + seeder). Sin ese stack se salta: no es un
/// test de unidad y no debe tocar producción.
final class HiloFlujoUITests: XCTestCase {
    private let api = "http://127.0.0.1:3001"
    private let bot = "http://127.0.0.1:3002"
    private let email = "primario@cepi.local"
    private let clave = "Admin123!"
    /// Valentina Castro Reyes, del seed ficticio.
    private let paciente = "11000000-0000-0000-1000-000000000009"

    /// Criterio de la fase 2 (PAPER §24.9): un turno enviado desde el iPhone queda en el mismo
    /// hilo que lee la web.
    @MainActor
    func testUnTurnoEnviadoDesdeLaAppQuedaEnElHilo() async throws {
        try await saltarSinStackLocal()
        let texto = "Prueba iOS \(UUID().uuidString.prefix(8))"

        let app = XCUIApplication()
        app.launchEnvironment = [
            "CEPI_API_BASE": api,
            "CEPI_BOT_BASE": bot,
            "CEPI_DEV_EMAIL": email,
            "CEPI_DEV_PASSWORD": clave,
            "CEPI_DEV_PACIENTE": paciente,
        ]
        app.launch()

        let caja = app.descendants(matching: .any)["composer.texto"]
        XCTAssertTrue(caja.waitForExistence(timeout: 90), "No se abrió el hilo del paciente")
        caja.tap()
        caja.typeText(texto)

        let enviar = app.buttons["composer.enviar"]
        try await esperar(90, "El botón Enviar no se habilitó") { enviar.isEnabled }
        enviar.tap()

        // Con el LLM en modo stub, cepi-bot contesta con un eco: si aparece, el turno pasó por el bot.
        let eco = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Eco: \"\(texto)\"")).firstMatch
        XCTAssertTrue(eco.waitForExistence(timeout: 90), "No llegó la respuesta del bot")

        // Y quedó en el hilo del backend, que es lo que muestra la web.
        let propios = try await mensajesPropiosEnElBackend()
        XCTAssertTrue(propios.contains(texto), "El turno no está en /api/patient-thread")
    }

    // MARK: - Ayudas

    // En el actor principal, como el test: `XCTestCase` no es `Sendable` y cruzar de actor con
    // `self` no compila en Swift 6.
    @MainActor
    private func saltarSinStackLocal() async throws {
        for servicio in [api, bot] {
            var pedido = URLRequest(url: URL(string: "\(servicio)/health")!)
            pedido.timeoutInterval = 3
            let status = (try? await URLSession.shared.data(for: pedido))
                .flatMap { ($0.1 as? HTTPURLResponse)?.statusCode }
            if status != 200 {
                throw XCTSkip("Stack local no disponible en \(servicio): ver docs/STATUS.md")
            }
        }
    }

    @MainActor
    private func mensajesPropiosEnElBackend() async throws -> [String] {
        var login = URLRequest(url: URL(string: "\(api)/api/auth/login")!)
        login.httpMethod = "POST"
        login.setValue("application/json", forHTTPHeaderField: "Content-Type")
        login.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": clave])
        let (datosLogin, _) = try await URLSession.shared.data(for: login)
        let token = try XCTUnwrap((try JSONSerialization.jsonObject(with: datosLogin) as? [String: Any])?["token"] as? String)

        var hilo = URLRequest(url: URL(string: "\(api)/api/patient-thread?patient_id=\(paciente)")!)
        hilo.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (datosHilo, _) = try await URLSession.shared.data(for: hilo)
        let mensajes = (try JSONSerialization.jsonObject(with: datosHilo) as? [String: Any])?["messages"] as? [[String: Any]] ?? []
        return mensajes.filter { $0["self"] as? Bool == true }.compactMap { $0["content"] as? String }
    }

    @MainActor
    private func esperar(_ segundos: Double, _ motivo: String, hasta condicion: () -> Bool) async throws {
        let limite = Date.now.addingTimeInterval(segundos)
        while !condicion() {
            guard Date.now < limite else { return XCTFail(motivo) }
            try await Task.sleep(for: .milliseconds(250))
        }
    }
}
