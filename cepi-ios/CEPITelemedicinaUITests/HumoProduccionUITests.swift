import XCTest

/// Prueba de humo contra PRODUCCIÓN antes de mandar un build a la tienda, con la cuenta demo del
/// revisor (solo vive en la org de pruebas, sandbox). Solo lee: entra, abre un paciente y pasa
/// por Chat, Ficha, la ficha de evolución e Imágenes. Deja capturas como adjuntos del test.
///
/// La cuenta llega por entorno (`TEST_RUNNER_CEPI_HUMO_EMAIL`, `TEST_RUNNER_CEPI_HUMO_PASSWORD`).
/// Sin ella se salta: no corre en la batería normal.
final class HumoProduccionUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testRecorridoDeLecturaEnProduccion() throws {
        let entorno = ProcessInfo.processInfo.environment
        guard let email = entorno["CEPI_HUMO_EMAIL"], let clave = entorno["CEPI_HUMO_PASSWORD"],
              !email.isEmpty, !clave.isEmpty else {
            throw XCTSkip("Sin la cuenta demo en el entorno")
        }
        let app = XCUIApplication()
        // Sin CEPI_API_BASE la app va a producción, como el build de la tienda.
        app.launchEnvironment = ["CEPI_DEV_EMAIL": email, "CEPI_DEV_PASSWORD": clave]
        app.launch()
        StackLocal.descartarGuardarContrasena(en: app)

        // Lista de pacientes.
        XCTAssertTrue(app.buttons["Nuevo paciente"].waitForExistence(timeout: 60), "No cargó la lista de pacientes")
        let primero = app.cells.firstMatch
        XCTAssertTrue(primero.waitForExistence(timeout: 60), "La lista no tiene pacientes")
        captura(app, "1 lista")
        primero.tap()

        // Chat del paciente.
        let acciones = app.buttons["Acciones"]
        XCTAssertTrue(acciones.waitForExistence(timeout: 60), "No abrió el paciente")
        StackLocal.esperarHiloAbierto(app)
        captura(app, "2 chat")

        // Evolución desde el menú del paciente: la sección nativa (PAPER §28.3).
        acciones.tap()
        let evolucionMenu = app.buttons["Evolución del paciente"]
        XCTAssertTrue(evolucionMenu.waitForExistence(timeout: 10), "No está «Evolución del paciente» en el menú")
        evolucionMenu.tap()
        esperarTexto(app, "Evolución del paciente")
        captura(app, "3 evolucion desde el menu")

        // Ficha editable y su botón Evolución.
        app.buttons["Ficha"].firstMatch.tap()
        esperarTexto(app, "grupos con dato")
        captura(app, "4 ficha")
        let evolucionFicha = app.buttons["Evolución"].firstMatch
        XCTAssertTrue(evolucionFicha.waitForExistence(timeout: 20), "No está el botón Evolución en la ficha")
        evolucionFicha.tap()
        esperarTexto(app, "Evolución del paciente")
        captura(app, "5 evolucion desde la ficha")

        // Imágenes.
        app.buttons["Imágenes"].firstMatch.tap()
        RunLoop.current.run(until: .now.addingTimeInterval(4))
        captura(app, "6 imagenes")
    }

    @MainActor
    private func esperarTexto(_ app: XCUIApplication, _ texto: String) {
        let elemento = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", texto)).firstMatch
        XCTAssertTrue(elemento.waitForExistence(timeout: 60), "No apareció «\(texto)»")
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }
}
