import XCTest

/// Cambiar de organización muestra la espera y después SOLO la lista de la org nueva. Antes
/// la lista de la org anterior quedaba a la vista (y tocable) hasta que llegaba la nueva, y
/// si justo había un refresco en curso, hasta 20 s.
final class OrganizacionUITests: XCTestCase {
    /// De `seeder/005`: solo existe en `cepi-drpro`.
    private let deDrpro = "Ficticio Solo DrPro"

    @MainActor
    func testCambiarDeOrgMuestraSoloLaListaNueva() async throws {
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

        // La lista es perezosa: se compara con la primera fila, que siempre está en pantalla.
        let primera = app.cells.firstMatch.staticTexts.firstMatch
        XCTAssertTrue(primera.waitForExistence(timeout: 60), "La lista de cepi no cargó")
        let deCepi = primera.label
        XCTAssertNotEqual(deCepi, deDrpro, "cepi muestra un paciente de cepi-drpro")

        elegirOrganizacion(app, contiene: "Consultorio")
        XCTAssertTrue(app.staticTexts[deDrpro].waitForExistence(timeout: 60), "La lista de cepi-drpro no cargó")
        XCTAssertFalse(app.staticTexts[deCepi].exists, "Quedó a la vista un paciente de la org anterior (\(deCepi))")

        // Y de vuelta, para dejar la cuenta en su org de siempre.
        elegirOrganizacion(app, contiene: "Telemedicina")
        XCTAssertTrue(app.staticTexts[deCepi].waitForExistence(timeout: 60), "No volvió a la lista de cepi")
        XCTAssertFalse(app.staticTexts[deDrpro].exists, "Quedó a la vista un paciente de cepi-drpro")
    }

    @MainActor
    private func elegirOrganizacion(_ app: XCUIApplication, contiene nombre: String) {
        let cuenta = app.buttons["Cuenta"]
        XCTAssertTrue(cuenta.waitForExistence(timeout: 30))
        cuenta.tap()
        let selector = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Organización")).firstMatch
        XCTAssertTrue(selector.waitForExistence(timeout: 10), "No está el selector de organización")
        selector.tap()
        let opcion = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", nombre)).firstMatch
        XCTAssertTrue(opcion.waitForExistence(timeout: 10), "No está la org \(nombre)")
        opcion.tap()
    }
}
