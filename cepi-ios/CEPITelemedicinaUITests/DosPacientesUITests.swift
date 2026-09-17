import XCTest

/// Abrir un paciente, volver a la lista y abrir otro: el segundo tiene que cargar igual que el
/// primero. Se quedaba en "Cargando la información…" para siempre.
final class DosPacientesUITests: XCTestCase {
    @MainActor
    func testElSegundoPacienteTambienCarga() async throws {
        try await StackLocal.saltarSiNoEsta()
        let app = XCUIApplication()
        app.launchEnvironment = [
            "CEPI_API_BASE": StackLocal.api,
            "CEPI_BOT_BASE": StackLocal.bot,
            "CEPI_DEV_EMAIL": StackLocal.email,
            "CEPI_DEV_PASSWORD": StackLocal.clave,
        ]
        app.launch()
        StackLocal.descartarGuardarContrasena(en: app)

        for indice in 0..<3 {
            let celda = app.cells.element(boundBy: indice)
            XCTAssertTrue(celda.waitForExistence(timeout: 60), "No está la fila \(indice)")
            let nombre = celda.staticTexts.firstMatch.label
            celda.tap()

            let caja = app.descendants(matching: .any)["composer.texto"]
            XCTAssertTrue(caja.waitForExistence(timeout: 30), "No se abrió el hilo de \(nombre)")
            let cargando = app.staticTexts["Cargando la información…"]
            let cargo = cargando.waitForNonExistence(timeout: 60)
            XCTAssertTrue(cargo, "El paciente \(indice + 1) (\(nombre)) se quedó cargando")

            app.navigationBars.buttons.element(boundBy: 0).tap()
            XCTAssertTrue(app.buttons["Nuevo paciente"].waitForExistence(timeout: 30), "No volvió a la lista")
        }
    }
}
