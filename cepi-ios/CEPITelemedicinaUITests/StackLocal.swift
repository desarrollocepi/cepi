import XCTest

/// El stack local de desarrollo (TodoERP :3001, cepi-bot :3002, datos ficticios) y cómo lanzar la
/// app contra él. Nunca producción: tiene PII real.
@MainActor
enum StackLocal {
    static let api = "http://127.0.0.1:3001"
    static let bot = "http://127.0.0.1:3002"
    static let email = "primario@cepi.local"
    static let clave = "Admin123!"
    /// Valentina Castro Reyes, del seed ficticio.
    static let paciente = "11000000-0000-0000-1000-000000000009"
    static let definicionEpisodio = "12000000-0000-0000-0000-000000000000"

    static func saltarSiNoEsta() async throws {
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

    /// La app entra sola y abre el hilo del paciente de prueba.
    static func lanzarApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "CEPI_API_BASE": api,
            "CEPI_BOT_BASE": bot,
            "CEPI_DEV_EMAIL": email,
            "CEPI_DEV_PASSWORD": clave,
            "CEPI_DEV_PACIENTE": paciente,
        ]
        app.launch()
        descartarGuardarContrasena(en: app)
        return app
    }

    /// Tras escribir usuario y contraseña, iOS ofrece guardarlos ("Save Password?") en un
    /// diálogo del sistema que tapa la app y bloquea los toques. Se descarta si aparece.
    static func descartarGuardarContrasena(en app: XCUIApplication, espera: TimeInterval = 8) {
        // El diálogo es una vista remota que aparece dentro del árbol de la propia app.
        let sistema = [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")]
        let limite = Date.now.addingTimeInterval(espera)
        repeat {
            for proceso in sistema {
                for etiqueta in ["Not Now", "Ahora no"] {
                    let boton = proceso.buttons[etiqueta]
                    if boton.exists {
                        boton.tap()
                        return
                    }
                }
            }
            RunLoop.current.run(until: .now.addingTimeInterval(0.5))
        } while Date.now < limite
    }

    /// Espera a que el hilo termine de abrir: el aviso de activación llega con las secciones.
    static func esperarHiloAbierto(_ app: XCUIApplication) {
        let aviso = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Paciente activo:")).firstMatch
        XCTAssertTrue(aviso.waitForExistence(timeout: 90), "No se abrió el hilo del paciente")
    }

    /// GET autenticado como el usuario de prueba; devuelve el JSON como diccionario.
    static func get(_ ruta: String) async throws -> [String: Any] {
        var login = URLRequest(url: URL(string: "\(api)/api/auth/login")!)
        login.httpMethod = "POST"
        login.setValue("application/json", forHTTPHeaderField: "Content-Type")
        login.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": clave])
        let (datosLogin, _) = try await URLSession.shared.data(for: login)
        let token = try XCTUnwrap((try JSONSerialization.jsonObject(with: datosLogin) as? [String: Any])?["token"] as? String)

        var pedido = URLRequest(url: URL(string: "\(api)\(ruta)")!)
        pedido.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (datos, _) = try await URLSession.shared.data(for: pedido)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: datos) as? [String: Any])
    }

    /// Reintenta hasta que la condición se cumpla en el backend (el guardado es asíncrono).
    static func esperarEnBackend(_ segundos: Double, _ condicion: () async throws -> Bool) async throws -> Bool {
        let limite = Date.now.addingTimeInterval(segundos)
        while Date.now < limite {
            if try await condicion() { return true }
            try await Task.sleep(for: .seconds(1))
        }
        return false
    }
}
