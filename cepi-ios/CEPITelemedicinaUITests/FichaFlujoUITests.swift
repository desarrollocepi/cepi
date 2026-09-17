import XCTest

/// Criterio de la fase 3 (PAPER §24.9): la ficha se llena desde el iPhone. Se prueba un grupo
/// con texto y uno de una sola pregunta, y se comprueba en el backend que quedaron guardados.
final class FichaFlujoUITests: XCTestCase {
    @MainActor
    func testUnGrupoDeLaFichaSeGuardaDesdeLaApp() async throws {
        try await StackLocal.saltarSiNoEsta()
        let texto = "\(Int.random(in: 2...40)) días iOS-\(UUID().uuidString.prefix(4))"

        let app = StackLocal.lanzarApp()
        StackLocal.esperarHiloAbierto(app)
        abrirSeccion(app, "3.2 Tiempo de evolución")

        let campo = app.textFields["campo.tiempo_evolucion"]
        XCTAssertTrue(campo.waitForExistence(timeout: 60), "No apareció el formulario 3.2")
        StackLocal.escribir(campo, texto)
        app.buttons["formulario.enviar"].tap()

        let guardado = try await StackLocal.esperarEnBackend(60) {
            let episodios = try await StackLocal.get(
                "/api/entities?type=business&entity_id=\(StackLocal.definicionEpisodio)&limit=100&filter%5Bpatient_id%5D=\(StackLocal.paciente)"
            )
            let valores = (episodios["data"] as? [[String: Any]] ?? [])
                .compactMap { ($0["data"] as? [String: Any])?["tiempo_evolucion"] as? String }
            return valores.contains(texto)
        }
        XCTAssertTrue(guardado, "El episodio no tiene tiempo_evolucion = \(texto)")
    }

    @MainActor
    func testUnaPreguntaDeOpcionSeGuardaAlElegir() async throws {
        try await StackLocal.saltarSiNoEsta()
        // Elegir una etnia distinta de la guardada, para que el cambio sea visible.
        let antes = try await etnia()
        let elegida = antes == "afro" ? "mestiza" : "afro"

        let app = StackLocal.lanzarApp()
        StackLocal.esperarHiloAbierto(app)
        abrirSeccion(app, "1.4 Etnia")

        let opcion = app.buttons[elegida]
        XCTAssertTrue(opcion.waitForExistence(timeout: 60), "No apareció el formulario 1.4")
        opcion.tap()

        let guardado = try await StackLocal.esperarEnBackend(60) { try await etnia() == elegida }
        XCTAssertTrue(guardado, "El paciente no quedó con etnia = \(elegida)")
    }

    // MARK: - Ayudas

    @MainActor
    private func abrirSeccion(_ app: XCUIApplication, _ nombre: String) {
        let acciones = app.buttons["Acciones"]
        XCTAssertTrue(acciones.waitForExistence(timeout: 30))
        acciones.tap()
        let secciones = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Secciones de la ficha")).firstMatch
        XCTAssertTrue(secciones.waitForExistence(timeout: 10), "No está el menú Secciones")
        secciones.tap()
        let seccion = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", nombre)).firstMatch
        XCTAssertTrue(seccion.waitForExistence(timeout: 10), "No está la sección \(nombre)")
        seccion.tap()
    }

    @MainActor
    private func etnia() async throws -> String? {
        let respuesta = try await StackLocal.get("/api/entities/\(StackLocal.paciente)")
        return ((respuesta["data"] as? [String: Any])?["data"] as? [String: Any])?["etnia"] as? String
    }
}
