import Foundation
import Testing
@testable import CEPITelemedicina

/// Cambiar de organización con una carga en curso. Antes `guard !cargando` descartaba la carga
/// de la org nueva y la lista de la anterior quedaba a la vista hasta el próximo refresco. Y el
/// filtro por estado de la ficha con lo que manda `patient-assignments`.
@MainActor
struct PacientesCargaTests {
    private static func lista(_ nombres: [String]) -> String {
        let filas = nombres.enumerated().map { indice, nombre in
            #"{"id":"p\#(indice)-\#(nombre)","data":{"nombre":"\#(nombre)"}}"#
        }
        return #"{"ok":true,"data":[\#(filas.joined(separator: ","))]}"#
    }

    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, credenciales: credenciales, configuracion: red))
    }

    @Test func alCambiarDeOrgSeVaciaYNoQuedaLaListaAnterior() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/review-queue", .http(200, #"{"ok":true,"by_patient":{}}"#))
        servidor.fijar("GET /api/patient-assignments", .http(200, #"{"ok":true,"assignments":{}}"#))
        servidor.fijar("GET /api/entities", .http(200, Self.lista(["Ana"])))
        let api = api(servidor)
        let modelo = PacientesModelo()

        modelo.usarOrganizacion("org-a")
        await modelo.cargar(api: api)
        #expect(modelo.filas.map(\.nombre) == ["Ana"])

        modelo.usarOrganizacion("org-b")
        #expect(modelo.filas.isEmpty)
        #expect(!modelo.cargado)   // la vista vuelve a "Cargando pacientes…"
    }

    @Test func unaRespuestaTardiaDeLaOrgAnteriorNoPisaLaNueva() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/review-queue", .http(200, #"{"ok":true,"by_patient":{}}"#))
        servidor.fijar("GET /api/patient-assignments", .http(200, #"{"ok":true,"assignments":{}}"#))
        // La primera carga (org A) tarda; la segunda (org B) llega enseguida.
        servidor.fijar(
            "GET /api/entities",
            .lenta(1.0, 200, Self.lista(["De la org A"])),
            .http(200, Self.lista(["De la org B"]))
        )
        let api = api(servidor)
        let modelo = PacientesModelo()
        modelo.usarOrganizacion("org-a")

        async let vieja: Void = modelo.cargar(api: api)
        try await Task.sleep(for: .milliseconds(200))
        modelo.usarOrganizacion("org-b")
        await modelo.cargar(api: api)
        #expect(modelo.filas.map(\.nombre) == ["De la org B"])

        await vieja
        #expect(modelo.filas.map(\.nombre) == ["De la org B"])
        #expect(modelo.cargado)
    }

    @Test func filtraPorEstadoYCuentaCadaUno() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/review-queue", .http(200, #"{"ok":true,"by_patient":{}}"#))
        servidor.fijar("GET /api/entities", .http(200, Self.lista(["Ana", "Beto", "Caro"])))
        servidor.fijar("GET /api/patient-assignments", .http(200, """
        {"ok":true,"assignments":{"p0-Ana":{"estado":"derivada"},"p1-Beto":{"estado":"derivada"},"p2-Caro":{"estado":"cerrado"}}}
        """))
        let modelo = PacientesModelo()
        await modelo.cargar(api: api(servidor))

        #expect(modelo.estado("p1-Beto") == .derivada)
        #expect(modelo.filtradas(por: "", estado: .derivada).map(\.id) == ["p0-Ana", "p1-Beto"])
        #expect(modelo.filtradas(por: "beto", estado: .derivada).map(\.id) == ["p1-Beto"])
        #expect(modelo.filtradas(por: "ana", estado: .cerrada).isEmpty)
        #expect(modelo.filtradas(por: "").count == 3)
        #expect(modelo.conteoPorEstado() == [.derivada: 2, .cerrada: 1])
    }
}
