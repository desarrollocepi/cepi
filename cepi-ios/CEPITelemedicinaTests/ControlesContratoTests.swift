import Foundation
import Testing
@testable import CEPITelemedicina

/// Próximos controles (PAPER §33): el JSON de `GET /api/bot/controles` y la carga de la
/// pantalla contra el bot.
struct ControlesContratoTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    static let controles = """
    {"ok":true,"today":"2026-11-09","from":"2026-10-10","to":"2027-02-07","data":[
      {"episode_id":"e1","patient_id":"p1","paciente":"Luis Mora","cedula":null,"fecha_control":"2026-11-02",
       "motivo":null,"plan":null,"diagnostico":null,"fecha_consulta":null,"medico":null,"estado_control":"atrasado"},
      {"episode_id":"e2","patient_id":"p2","paciente":"Ana Pérez","cedula":"0102","fecha_control":"2026-11-11",
       "motivo":"Control de nevus","plan":"Dermatoscopía","diagnostico":"Nevus","fecha_consulta":"2026-10-01",
       "medico":"Dra. Gaby","estado_control":"proximo"},
      {"episode_id":"e3","patient_id":null,"paciente":"Sin ficha","cedula":"0999","fecha_control":"2026-11-09",
       "motivo":"Retirar puntos","plan":null,"diagnostico":null,"fecha_consulta":"2026-11-01","medico":null,
       "estado_control":"hoy"}]}
    """

    @Test func decodificaLaLista() throws {
        let lista = try JSONDecoder().decode(ControlList.self, from: Data(Self.controles.utf8))
        #expect(lista.today == "2026-11-09")
        #expect(lista.from == "2026-10-10")
        #expect(lista.to == "2027-02-07")
        #expect(lista.data.map(\.id) == ["e1", "e2", "e3"])

        let ana = lista.data[1]
        #expect(ana.episodeId == "e2")
        #expect(ana.patientId == "p2")
        #expect(ana.patientName == "Ana Pérez")
        #expect(ana.cedula == "0102")
        #expect(ana.controlDate == "2026-11-11")
        #expect(ana.reason == "Control de nevus")
        #expect(ana.plan == "Dermatoscopía")
        #expect(ana.diagnosis == "Nevus")
        #expect(ana.consultationDate == "2026-10-01")
        #expect(ana.doctor == "Dra. Gaby")
        #expect(ana.status == .upcoming)

        let luis = lista.data[0]
        #expect(luis.status == .overdue)
        #expect(luis.cedula == nil)
        #expect(luis.reason == nil)
        #expect(luis.plan == nil)
        #expect(luis.doctor == nil)
        #expect(lista.data[2].status == .today)
        #expect(lista.data[2].patientId == nil)
    }

    @Test func textosDeLaFila() throws {
        let lista = try JSONDecoder().decode(ControlList.self, from: Data(Self.controles.utf8))
        let ana = lista.data[1]
        #expect(ControlsCalendar.weekday(ana.controlDate) == "miércoles")
        #expect(ControlsCalendar.longDate(ana.controlDate) == "11 nov 2026")
        #expect(ControlsCalendar.metaLine(ana) == "Nevus · indicó Dra. Gaby · consulta del 1 oct 2026")
        #expect(ControlsCalendar.metaLine(lista.data[0]) == "")
        #expect(ControlsCalendar.metaLine(lista.data[2]) == "consulta del 1 nov 2026")
    }

    @Test func estadoDesconocidoCuentaComoProximo() throws {
        let json = #"{"ok":true,"data":[{"episode_id":"e9","patient_id":"p9","paciente":"X","fecha_control":"2026-12-01","estado_control":"otro"}]}"#
        let lista = try JSONDecoder().decode(ControlList.self, from: Data(json.utf8))
        #expect(lista.today == nil)
        #expect(lista.data.first?.status == .upcoming)
    }

    @Test @MainActor func cargaContraElBotYAgrupa() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/bot/controles", .http(200, Self.controles))
        let modelo = ControlsModel()

        await modelo.load(api: api(servidor))
        #expect(servidor.pedidos.contains("GET /api/bot/controles"))
        #expect(modelo.error == nil)
        #expect(modelo.loaded)
        #expect(modelo.today == "2026-11-09")
        #expect(modelo.groups.map(\.title) == ["Atrasados", "Esta semana"])
        #expect(modelo.groups[1].controls.map(\.id) == ["e2", "e3"])

        modelo.query = "zzz"
        #expect(modelo.groups.isEmpty)
        #expect(modelo.emptyText == "Ningún control para «zzz»")
        modelo.query = ""
        #expect(modelo.emptyText == "No hay controles agendados en los próximos 90 días")
    }

    @Test @MainActor func elErrorSeMuestra() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/bot/controles", .http(403, #"{"ok":false,"error":"Sin permiso"}"#))
        let modelo = ControlsModel()
        await modelo.load(api: api(servidor))
        #expect(modelo.error?.hasPrefix("No se pudieron cargar los controles") == true)
        #expect(!modelo.loaded)
    }
}
