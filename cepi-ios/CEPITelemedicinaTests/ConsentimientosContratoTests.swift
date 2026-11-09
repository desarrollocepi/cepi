import Foundation
import Testing
@testable import CEPITelemedicina

/// Consentimientos del paciente (PAPER §31.2): el JSON de cepi-bot, el cuerpo del POST y
/// cuándo se puede subir.
struct ConsentimientosContratoTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    static let listado = """
    {"ok":true,
     "informado":[
       {"id":"c2","attachment_id":"a2","fecha":"2026-11-09","subido_por":"u1"},
       {"id":"c1","attachment_id":null,"fecha":null,"subido_por":null}],
     "privacidad_datos":[
       {"id":"c3","attachment_id":"a3","fecha":"2026-11-08","subido_por":"u2"}]}
    """

    @Test func decodificaLosDosTipos() throws {
        let lista = try JSONDecoder().decode(ConsentList.self, from: Data(Self.listado.utf8))
        #expect(lista.photos(.informado).map(\.id) == ["c2", "c1"])
        let nueva = lista.photos(.informado)[0]
        #expect(nueva.attachmentId == "a2")
        #expect(nueva.date == "2026-11-09")
        #expect(nueva.uploadedBy == "u1")
        // Registro viejo sin foto recuperable: se muestra como «Sin foto».
        let vieja = lista.photos(.informado)[1]
        #expect(vieja.attachmentId == nil)
        #expect(vieja.date == nil)
        #expect(vieja.uploadedBy == nil)
        let privacidad = try #require(lista.photos(.privacidadDatos).first)
        #expect(privacidad.id == "c3")
        #expect(privacidad.attachmentId == "a3")
        #expect(privacidad.date == "2026-11-08")
    }

    @Test func listaVaciaYClavesAusentes() throws {
        let vacia = try JSONDecoder().decode(ConsentList.self, from: Data(#"{"ok":true,"informado":[],"privacidad_datos":[]}"#.utf8))
        #expect(vacia.photos(.informado).isEmpty)
        #expect(vacia.photos(.privacidadDatos).isEmpty)
        let sinClaves = try JSONDecoder().decode(ConsentList.self, from: Data(#"{"ok":true}"#.utf8))
        #expect(sinClaves.photos(.privacidadDatos).isEmpty)
    }

    @Test func cuerpoDelPost() throws {
        for (tipo, crudo) in [(ConsentType.informado, "informado"), (.privacidadDatos, "privacidad_datos")] {
            let cuerpo = try JSONEncoder().encode(ConsentSave(patientId: "p1", type: tipo, attachmentIds: ["a1", "a2"]))
            let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
            #expect(json["patient_id"] as? String == "p1")
            #expect(json["tipo"] as? String == crudo)
            #expect(json["attachment_ids"] as? [String] == ["a1", "a2"])
            #expect(json.count == 3)
        }
    }

    @Test func pideYGuardaContraElBot() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/bot/consentimientos", .http(200, Self.listado))
        servidor.fijar("POST /api/bot/consentimientos", .http(200, #"{"ok":true,"ids":["c9"],"errors":[]}"#))
        let cepi = api(servidor)

        let lista = try await cepi.consents(patient: "p1")
        #expect(lista.photos(.informado).count == 2)

        let resultado = try await cepi.saveConsents(patient: "p1", type: .privacidadDatos, attachmentIds: ["a9"])
        #expect(resultado.ids == ["c9"])
        #expect(resultado.errors.isEmpty)
        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/bot/consentimientos"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(json["tipo"] as? String == "privacidad_datos")
        #expect(json["attachment_ids"] as? [String] == ["a9"])
    }

    @Test @MainActor func elBotonDiceSiempreElMotivo() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/bot/consentimientos", .http(200, Self.listado))
        let modelo = ConsentsModel(patient: "p1")
        #expect(modelo.uploadBlockReason(.informado) == "Espera a que carguen los consentimientos")
        await modelo.load(api: api(servidor))
        #expect(modelo.loaded)
        #expect(modelo.uploadBlockReason(.informado) == nil)
        #expect(modelo.uploadBlockReason(.privacidadDatos) == nil)
    }
}
