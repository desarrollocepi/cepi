import Foundation
import Testing
@testable import CEPITelemedicina

/// Las formas JSON que devuelve el backend hoy (PAPER §24.4). Si el backend cambia una
/// clave, falla acá y no en la mano de un médico.
struct ContratoTests {
    private func decodificar<T: Decodable>(_ tipo: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(tipo, from: Data(json.utf8))
    }

    @Test func sesionDeMe() throws {
        let respuesta = try decodificar(SesionRespuesta.self, """
        {"ok":true,"token":"abc","user":{"id":"u1","name":"Dra. Pérez","email":"p@cepi.ec",
         "role":"medico_primario","phone":"","cedula":"","permissions":["entity:x:record:create"],
         "org_id":"o2","orgs":[{"id":"o1","slug":"cepi","name":"CEPI","role_in_org":"member"},
         {"id":"o2","slug":"cepi-testing","name":"CEPI Testing","role_in_org":"member"}]}}
        """)
        #expect(respuesta.token == "abc")
        #expect(respuesta.user.orgActiva == "o2")
        #expect(respuesta.user.orgs.map(\.name) == ["CEPI", "CEPI Testing"])
        #expect(respuesta.user.permissions == ["entity:x:record:create"])
    }

    @Test func loginSinOrganizaciones() throws {
        let respuesta = try decodificar(SesionRespuesta.self, """
        {"ok":true,"token":"t","user":{"id":"u","name":"X","email":"x@cepi.ec","role":"pendiente","permissions":[]}}
        """)
        #expect(respuesta.user.orgs.isEmpty)
        #expect(respuesta.user.orgActiva == nil)
        #expect(respuesta.user.role == "pendiente")
    }

    @Test func registroConCamposDinamicos() throws {
        let lista = try decodificar(Lista<Registro>.self, """
        {"ok":true,"data":[{"id":"p1","title":"Ana Ruiz","entity_id":"11000000-0000-0000-0000-000000000000",
          "data":{"nombre":"Ana","apellidos":" Ruiz ","cedula":1712345678,"alergias":null,
                  "fumador":true,"peso":61.5,"regiones":["torax"],"vacio":""}}]}
        """)
        let paciente = try #require(lista.data.first)
        #expect(paciente.definicion == CEPIAPI.definicionPaciente)
        #expect(paciente["nombre"] == "Ana")
        #expect(paciente["apellidos"] == "Ruiz")
        #expect(paciente["cedula"] == "1712345678")
        #expect(paciente["peso"] == "61.5")
        #expect(paciente["alergias"] == nil)
        #expect(paciente["vacio"] == nil)
        #expect(paciente.data["fumador"] == .booleano(true))
        #expect(paciente.data["regiones"] == .lista([.texto("torax")]))
    }

    @Test func registroSinData() throws {
        let registro = try decodificar(Registro.self, #"{"id":"r1","title":null}"#)
        #expect(registro.data.isEmpty)
        #expect(registro.title == nil)
    }

    @Test func colaDeRevisionYAsignaciones() throws {
        let cola = try decodificar(ColaRevision.self, """
        {"ok":true,"patient_ids":["p1"],"by_patient":{"p1":{"pending":2,"earliest_due":"2026-09-15T10:00:00.000Z"}}}
        """)
        #expect(cola.porPaciente["p1"]?.pendientes == 2)

        let asignaciones = try decodificar(Asignaciones.self, """
        {"ok":true,"assignments":{"p1":{"assignee_id":"u9","assignee_name":"Dr. Mora","source":"derivado_grupo","estado":"derivada"}}}
        """)
        #expect(asignaciones.porPaciente["p1"]?.nombre == "Dr. Mora")
        #expect(asignaciones.porPaciente["p1"]?.origen == "derivado_grupo")
    }

    @Test func urlCodificaElMas() {
        let url = APIClient.url(
            base: URL(string: "https://telemedicina.cepi.ec")!,
            ruta: "/api/entities",
            query: [
                URLQueryItem(name: "q", value: "a+b ñ"),
                URLQueryItem(name: "filter[patient_id]", value: "p1"),
            ]
        )
        #expect(url.absoluteString.hasPrefix("https://telemedicina.cepi.ec/api/entities?"))
        #expect(url.query(percentEncoded: true)?.contains("q=a%2Bb%20%C3%B1") == true)
        #expect(url.query(percentEncoded: false)?.contains("filter[patient_id]=p1") == true)
    }
}
