import XCTest

/// El recorrido de quien revisa la app para la App Store: una cuenta que solo es miembro de la
/// org de pruebas (sandbox), con el login escrito a mano. Tiene que poder hacer todo lo que
/// hace un médico sin ver nada de las orgs reales (PAPER §24.7, D-Aux-21).
///
/// Las cuentas las crea `scripts/cuenta-revisor.mjs` contra el stack local y llegan por entorno:
/// `TEST_RUNNER_CEPI_REVISOR_EMAIL`, `TEST_RUNNER_CEPI_REVISOR_BORRAR` (se borra en el test) y
/// `TEST_RUNNER_CEPI_REVISOR_PENDIENTE` (sin aprobar). Sin ellas, o sin stack local, se salta.
final class RevisorUITests: XCTestCase {
    private static let clave = "Revisor2026!"
    /// Un paciente que solo tiene datos en la org real `cepi`: la sandbox no lo puede ver.
    private static let pacienteDeOtraOrg = "11000000-0000-0000-1000-000000000044"

    override func setUp() {
        continueAfterFailure = false
        // Si el diálogo de guardar contraseña reaparece en medio de un paso, se descarta.
        addUIInterruptionMonitor(withDescription: "Guardar contraseña") { alerta in
            for etiqueta in ["Not Now", "Ahora no"] where alerta.buttons[etiqueta].exists {
                alerta.buttons[etiqueta].tap()
                return true
            }
            return false
        }
    }

    @MainActor
    func testRecorridoCompletoDelRevisor() async throws {
        let email = try await cuenta("CEPI_REVISOR_EMAIL")
        let api = Revisor(email: email, clave: Self.clave)

        // Lo que la sandbox ve por API es lo que la app tiene que mostrar: solo pacientes suyos.
        let visibles = try await api.pacientes()
        XCTAssertFalse(visibles.isEmpty, "La sandbox no tiene pacientes ficticios: falta el seed")
        XCTAssertFalse(visibles.contains { $0.id == Self.pacienteDeOtraOrg }, "La sandbox ve un paciente de la org real")
        let conocido = try XCTUnwrap(visibles.first)

        let app = lanzarSinSesion()
        entrar(app, email: email)

        // Lista y búsqueda. Se busca con la lista ya cargada: mientras carga, la vista de
        // "Cargando pacientes…" se reemplaza y el buscador pierde el foco a mitad de escribir.
        let fila = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", conocido.nombre)).firstMatch
        XCTAssertTrue(fila.waitForExistence(timeout: 60), "La lista no muestra a \(conocido.nombre)")
        let buscador = app.searchFields.firstMatch
        escribir(buscador, String(conocido.nombre.prefix(6)))
        XCTAssertTrue(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", conocido.nombre)).firstMatch
                .waitForExistence(timeout: 20),
            "La búsqueda no encontró a \(conocido.nombre)"
        )
        salirDeLaBusqueda(app)

        // Alta de paciente: abre su hilo.
        let sufijo = String(UUID().uuidString.prefix(4))
        app.buttons["Nuevo paciente"].tap()
        escribir(app.textFields["Nombre"], "Revisión")
        escribir(app.textFields["Apellidos"], "Apple \(sufijo)")
        escribir(app.textFields["Cédula"], "09\(Int.random(in: 10_000_000...99_999_999))")
        app.buttons["Crear"].tap()

        let caja = app.descendants(matching: .any)["composer.texto"]
        XCTAssertTrue(caja.waitForExistence(timeout: 60), "No se abrió el hilo del paciente nuevo")
        let aviso = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Paciente activo:")).firstMatch
        XCTAssertTrue(aviso.waitForExistence(timeout: 90), "El bot no activó al paciente nuevo")
        let nuevo = try await esperarValor(60, "El paciente nuevo no está en la lista de la sandbox") {
            try await api.pacientes().first { $0.nombre.contains("Apple \(sufijo)") }
        }

        // Un turno de chat.
        let texto = "Lesión pigmentada en espalda \(sufijo)"
        caja.tap()
        caja.typeText(texto)
        let enviar = app.buttons["composer.enviar"]
        try await esperar(60, "El botón Enviar no se habilitó") { enviar.isEnabled }
        enviar.tap()
        XCTAssertTrue(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", texto)).firstMatch
                .waitForExistence(timeout: 90),
            "El turno no apareció en el hilo"
        )

        // Un grupo de la ficha, guardado en el episodio de la sandbox.
        abrirSeccion(app, "3.2 Tiempo de evolución")
        let campo = app.textFields["campo.tiempo_evolucion"]
        XCTAssertTrue(campo.waitForExistence(timeout: 60), "No apareció el formulario 3.2")
        let evolucion = "3 meses \(sufijo)"
        escribir(campo, evolucion)
        app.buttons["formulario.enviar"].tap()
        let guardado = try await esperarValor(60, "La ficha no guardó tiempo_evolucion") {
            try await api.episodios(paciente: nuevo.id).contains { $0["tiempo_evolucion"] as? String == evolucion } ? true : nil
        }
        XCTAssertTrue(guardado)

        // Derivar a un círculo: solo aparecen personas de la sandbox, y la derivación se confirma.
        acciones(app, "Derivar")
        let circulo = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Dermatología")).firstMatch
        XCTAssertTrue(circulo.waitForExistence(timeout: 30), "No aparecen los círculos para derivar")
        let miembros = try await api.miembros(grupo: "dermatologia")
        XCTAssertFalse(miembros.isEmpty, "Dermatología no tiene miembros en la sandbox")
        circulo.tap()
        // Derivar entrega el caso: el hilo se cierra y se vuelve a la lista (igual que la web).
        XCTAssertTrue(app.buttons["Nuevo paciente"].waitForExistence(timeout: 90), "Derivar no volvió a la lista")
        let derivado = try await esperarValor(60, "El paciente no quedó asignado a Dermatología") {
            let asignaciones = try await api.get("/api/patient-assignments")["assignments"] as? [String: Any]
            return asignaciones?[nuevo.id] != nil ? true : nil
        }
        XCTAssertTrue(derivado)

        // Reabrir el paciente, ver la ficha y cerrarla.
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Apple \(sufijo)")).firstMatch.tap()
        XCTAssertTrue(caja.waitForExistence(timeout: 60), "No se reabrió el hilo del paciente")
        acciones(app, "Ver ficha")
        let cerrarFicha = app.buttons["Cerrar"]
        XCTAssertTrue(cerrarFicha.waitForExistence(timeout: 60), "No se abrió el visor de la ficha")
        XCTAssertTrue(app.navigationBars.containing(NSPredicate(format: "identifier CONTAINS %@", "Ficha")).firstMatch.exists
            || app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Ficha")).firstMatch.exists)
        cerrarFicha.tap()

        // Cerrar sesión vuelve al login.
        volverALaLista(app)
        menuCuenta(app, "Cerrar sesión")
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 30), "Cerrar sesión no volvió al login")
    }

    @MainActor
    func testElRevisorBorraSuCuentaDesdeLaApp() async throws {
        let email = try await cuenta("CEPI_REVISOR_BORRAR")
        let app = lanzarSinSesion()
        entrar(app, email: email)
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 60), "No apareció la lista de pacientes")

        menuCuenta(app, "Eliminar cuenta")
        confirmarBorrado(app)
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 30), "Tras borrar la cuenta no volvió al login")
        let puedeEntrar = try? await Revisor(email: email, clave: Self.clave).token()
        XCTAssertNil(puedeEntrar, "La cuenta borrada todavía puede iniciar sesión")
    }

    @MainActor
    func testUnaCuentaPendienteTambienSePuedeBorrar() async throws {
        let email = try await cuenta("CEPI_REVISOR_PENDIENTE")
        let app = lanzarSinSesion()
        entrar(app, email: email)
        let borrar = app.buttons["Eliminar cuenta"]
        XCTAssertTrue(borrar.waitForExistence(timeout: 60), "No apareció la pantalla de cuenta pendiente")
        borrar.tap()
        confirmarBorrado(app)
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 30), "Tras borrar la cuenta pendiente no volvió al login")
    }

    // MARK: - Pasos de UI

    /// La app sin sesión. El Keychain del simulador sobrevive entre lanzamientos: si quedó una
    /// sesión de otro test, se cierra por el menú, como lo haría una persona.
    @MainActor
    private func lanzarSinSesion() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "CEPI_API_BASE": StackLocal.api,
            "CEPI_BOT_BASE": StackLocal.bot,
            "CEPI_WEB_BASE": "http://127.0.0.1:5174",
        ]
        app.launch()
        let email = app.textFields["Email"]
        let lista = app.searchFields.firstMatch
        let pendiente = app.buttons["Volver a comprobar"]
        let limite = Date.now.addingTimeInterval(60)
        while Date.now < limite, !email.exists, !lista.exists, !pendiente.exists {
            RunLoop.current.run(until: .now.addingTimeInterval(0.5))
        }
        if lista.exists {
            menuCuenta(app, "Cerrar sesión")
        } else if pendiente.exists {
            app.buttons["Cerrar sesión"].tap()
        }
        XCTAssertTrue(email.waitForExistence(timeout: 30), "No apareció el login")
        return app
    }

    @MainActor
    private func entrar(_ app: XCUIApplication, email: String) {
        escribir(app.textFields["Email"], email)
        escribir(app.secureTextFields["Contraseña"], Self.clave)
        app.buttons["Ingresar"].tap()
        StackLocal.descartarGuardarContrasena(en: app)
    }

    @MainActor
    private func escribir(_ campo: XCUIElement, _ texto: String) {
        XCTAssertTrue(campo.waitForExistence(timeout: 30), "No existe el campo \(campo)")
        // En el primer lanzamiento de un simulador el toque puede llegar antes de que la
        // pantalla acepte el foco: se reintenta hasta que el campo tenga el teclado.
        let limite = Date.now.addingTimeInterval(15)
        repeat {
            campo.tap()
            RunLoop.current.run(until: .now.addingTimeInterval(0.7))
        } while !((campo.value(forKey: "hasKeyboardFocus") as? Bool) ?? false) && Date.now < limite
        if let actual = campo.value as? String, !actual.isEmpty, actual != campo.placeholderValue {
            campo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: actual.count))
        }
        campo.typeText(texto)
    }

    /// Abre el menú Cuenta y elige `opcion`. Reintenta si el menú se cerró antes de tiempo o
    /// si algo lo tapa (el diálogo de guardar contraseña puede llegar tarde).
    @MainActor
    private func menuCuenta(_ app: XCUIApplication, _ opcion: String) {
        let cuenta = app.buttons["Cuenta"]
        XCTAssertTrue(cuenta.waitForExistence(timeout: 30), "No está el menú Cuenta")
        let boton = app.buttons.matching(NSPredicate(format: "label == %@", opcion)).firstMatch
        for _ in 1...4 {
            StackLocal.descartarGuardarContrasena(en: app, espera: 1)
            if !boton.exists { cuenta.tap() }
            let limite = Date.now.addingTimeInterval(4)
            while !(boton.exists && boton.isHittable), Date.now < limite {
                RunLoop.current.run(until: .now.addingTimeInterval(0.3))
            }
            if boton.exists, boton.isHittable {
                boton.tap()
                return
            }
            // Cerrar lo que haya abierto y volver a intentar.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97)).tap()
        }
        print("DIAG-MENU-CUENTA\n\(app.debugDescription)")
        XCTFail("No se pudo elegir \(opcion) en el menú Cuenta")
    }

    /// Con la búsqueda activa la barra esconde "Nuevo paciente" y "Cuenta", y la forma de
    /// cerrarla cambia entre versiones de iOS. Reabrir la app es estable: la sesión sigue en
    /// el Keychain y vuelve a la lista sin búsqueda.
    @MainActor
    private func salirDeLaBusqueda(_ app: XCUIApplication) {
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["Nuevo paciente"].waitForExistence(timeout: 60), "La app no volvió a la lista")
    }

    @MainActor
    private func confirmarBorrado(_ app: XCUIApplication) {
        let alerta = app.alerts["¿Eliminar tu cuenta?"]
        XCTAssertTrue(alerta.waitForExistence(timeout: 10), "No apareció la confirmación del borrado")
        // La alerta llega animada: el botón existe antes de poder tocarse.
        let eliminar = alerta.buttons["Eliminar cuenta"]
        let limite = Date.now.addingTimeInterval(10)
        while !eliminar.isHittable, Date.now < limite {
            RunLoop.current.run(until: .now.addingTimeInterval(0.3))
        }
        eliminar.tap()
    }

    @MainActor
    private func acciones(_ app: XCUIApplication, _ opcion: String) {
        let menu = app.buttons["Acciones"]
        XCTAssertTrue(menu.waitForExistence(timeout: 30), "No está el menú Acciones")
        menu.tap()
        let boton = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", opcion)).firstMatch
        XCTAssertTrue(boton.waitForExistence(timeout: 10), "No está \(opcion) en Acciones")
        boton.tap()
    }

    @MainActor
    private func abrirSeccion(_ app: XCUIApplication, _ nombre: String) {
        acciones(app, "Secciones de la ficha")
        let seccion = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", nombre)).firstMatch
        XCTAssertTrue(seccion.waitForExistence(timeout: 10), "No está la sección \(nombre)")
        seccion.tap()
    }

    /// En iPhone el hilo tapa la lista: se vuelve con el botón atrás. En iPad ya están juntas.
    @MainActor
    private func volverALaLista(_ app: XCUIApplication) {
        if app.buttons["Cuenta"].exists { return }
        let atras = app.navigationBars.buttons.element(boundBy: 0)
        if atras.exists { atras.tap() }
    }

    // MARK: - Espera y entorno

    @MainActor
    private func cuenta(_ clave: String) async throws -> String {
        try await StackLocal.saltarSiNoEsta()
        guard let email = ProcessInfo.processInfo.environment[clave], !email.isEmpty else {
            throw XCTSkip("Falta \(clave): crear la cuenta con scripts/cuenta-revisor.mjs")
        }
        return email
    }

    @MainActor
    private func esperar(_ segundos: Double, _ mensaje: String, _ condicion: () -> Bool) async throws {
        let limite = Date.now.addingTimeInterval(segundos)
        while Date.now < limite {
            if condicion() { return }
            try await Task.sleep(for: .milliseconds(500))
        }
        XCTFail(mensaje)
    }

    @MainActor
    private func esperarValor<T>(_ segundos: Double, _ mensaje: String, _ valor: () async throws -> T?) async throws -> T {
        let limite = Date.now.addingTimeInterval(segundos)
        while Date.now < limite {
            if let resultado = try await valor() { return resultado }
            try await Task.sleep(for: .seconds(1))
        }
        XCTFail(mensaje)
        throw XCTSkip(mensaje)
    }
}

/// La API vista por la cuenta del revisor, para comprobar en el backend lo que hizo la UI.
@MainActor
private struct Revisor {
    struct Paciente { let id: String; let nombre: String }

    let email: String
    let clave: String

    func token() async throws -> String {
        var pedido = URLRequest(url: URL(string: "\(StackLocal.api)/api/auth/login")!)
        pedido.httpMethod = "POST"
        pedido.setValue("application/json", forHTTPHeaderField: "Content-Type")
        pedido.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": clave])
        let (datos, respuesta) = try await URLSession.shared.data(for: pedido)
        guard (respuesta as? HTTPURLResponse)?.statusCode == 200,
              let token = (try JSONSerialization.jsonObject(with: datos) as? [String: Any])?["token"] as? String
        else { throw URLError(.userAuthenticationRequired) }
        return token
    }

    func get(_ ruta: String) async throws -> [String: Any] {
        var pedido = URLRequest(url: URL(string: "\(StackLocal.api)\(ruta)")!)
        pedido.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        let (datos, _) = try await URLSession.shared.data(for: pedido)
        return (try JSONSerialization.jsonObject(with: datos) as? [String: Any]) ?? [:]
    }

    func pacientes() async throws -> [Paciente] {
        let lista = try await get("/api/entities?type=business&entity_id=11000000-0000-0000-0000-000000000000&limit=500")
        return (lista["data"] as? [[String: Any]] ?? []).compactMap { fila in
            guard let id = fila["id"] as? String else { return nil }
            let datos = fila["data"] as? [String: Any] ?? [:]
            let nombre = [datos["nombre"] as? String, datos["apellidos"] as? String]
                .compactMap { $0 }.joined(separator: " ")
            return Paciente(id: id, nombre: nombre.isEmpty ? (fila["title"] as? String ?? "") : nombre)
        }
    }

    func episodios(paciente: String) async throws -> [[String: Any]] {
        let lista = try await get(
            "/api/entities?type=business&entity_id=\(StackLocal.definicionEpisodio)&limit=100&filter%5Bpatient_id%5D=\(paciente)"
        )
        return (lista["data"] as? [[String: Any]] ?? []).compactMap { $0["data"] as? [String: Any] }
    }

    func miembros(grupo: String) async throws -> [[String: Any]] {
        (try await get("/api/groups/\(grupo)/members"))["data"] as? [[String: Any]] ?? []
    }
}
