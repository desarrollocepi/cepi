import Foundation
import Testing
@testable import CEPITelemedicina

/// Turnos de un grupo (PAPER §32): el JSON de TodoERP, el cuerpo del POST y la carga de la
/// pantalla con el «hoy» del servidor.
struct TurnosContratoTests {
    private func api(_ servidor: ServidorFalso) -> CEPIAPI {
        let red = URLSessionConfiguration.ephemeral
        red.protocolClasses = [ProtocoloFalso.self]
        let base = URL(string: "https://\(servidor.host)")!
        let credenciales = Credenciales(cuenta: "prueba-\(UUID().uuidString)")
        return CEPIAPI(cliente: APIClient(base: base, baseBot: base, credenciales: credenciales, configuracion: red))
    }

    static let grupos = """
    {"ok":true,"data":[
      {"id":"g0","slug":"todos","name":"Todos","kind":"all","member_count":12},
      {"id":"g1","slug":"turno","name":"Turno","kind":"roster","member_count":3},
      {"id":"g2","slug":"dermatologia","name":"Dermatología","kind":"specialty","member_count":2}]}
    """

    static let miembros = """
    {"ok":true,"data":[
      {"user_id":"u1","name":"Dra. Ana","email":"ana@cepi.ec","role_in_group":"member","created_at":"2026-10-01T10:00:00.000Z"},
      {"user_id":"u2","name":"Dr. Luis","email":"luis@cepi.ec","role_in_group":"member","created_at":"2026-10-02T10:00:00.000Z"}]}
    """

    static let turnos = """
    {"ok":true,"data":[
      {"id":"s1","user_id":"u1","user_name":"Dra. Ana","starts_on":"2026-11-09","ends_on":"2026-11-15","created_by":"u9","created_at":"2026-11-08T12:00:00.000Z"},
      {"id":"s2","user_id":"u2","user_name":"Dr. Luis","starts_on":"2026-11-18","ends_on":"2026-11-20","created_by":null,"created_at":"2026-11-08T12:05:00.000Z"}],
     "from":"2026-11-09","to":"2027-01-03","today":"2026-11-11"}
    """

    static let creado = """
    {"ok":true,"data":{"id":"s3","user_id":"u2","user_name":"Dr. Luis","starts_on":"2026-11-23","ends_on":"2026-11-29","created_by":"u1","created_at":"2026-11-09T15:00:00.000Z"}}
    """

    @Test func decodificaLaListaConHoy() throws {
        let lista = try JSONDecoder().decode(ShiftList.self, from: Data(Self.turnos.utf8))
        #expect(lista.today == "2026-11-11")
        #expect(lista.from == "2026-11-09")
        #expect(lista.to == "2027-01-03")
        #expect(lista.data.map(\.id) == ["s1", "s2"])
        let ana = lista.data[0]
        #expect(ana.userId == "u1")
        #expect(ana.userName == "Dra. Ana")
        #expect(ana.startsOn == "2026-11-09")
        #expect(ana.endsOn == "2026-11-15")
        #expect(ana.createdBy == "u9")
        #expect(lista.data[1].createdBy == nil)
    }

    @Test func cuerpoDelPost() throws {
        let cuerpo = try JSONEncoder().encode(ShiftCreate(userId: "u2", startsOn: "2026-11-23", endsOn: "2026-11-29"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(json["user_id"] as? String == "u2")
        #expect(json["starts_on"] as? String == "2026-11-23")
        #expect(json["ends_on"] as? String == "2026-11-29")
        #expect(json.count == 3)
    }

    @Test func pideCreaYBorraContraElERP() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/groups/dermatologia/shifts", .http(200, Self.turnos))
        servidor.fijar("POST /api/groups/dermatologia/shifts", .http(201, Self.creado))
        servidor.fijar("DELETE /api/groups/dermatologia/shifts/s1", .http(200, #"{"ok":true}"#))
        let cepi = api(servidor)

        let lista = try await cepi.shifts(group: "dermatologia", from: "2026-11-09", to: "2027-01-03")
        #expect(lista.data.count == 2)

        let nuevo = try await cepi.createShift(
            group: "dermatologia", ShiftCreate(userId: "u2", startsOn: "2026-11-23", endsOn: "2026-11-29")
        )
        #expect(nuevo.id == "s3")
        #expect(nuevo.userName == "Dr. Luis")
        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/groups/dermatologia/shifts"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(json["user_id"] as? String == "u2")

        try await cepi.deleteShift(group: "dermatologia", id: "s1")
        #expect(servidor.pedidos.contains("DELETE /api/groups/dermatologia/shifts/s1"))
    }

    @Test func elErrorDelBackendLlegaConSuMotivo() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("POST /api/groups/dermatologia/shifts", .http(403, #"{"ok":false,"error":"Sin permiso"}"#))
        await #expect(throws: APIError.self) {
            _ = try await api(servidor).createShift(
                group: "dermatologia", ShiftCreate(userId: "u2", startsOn: "2026-11-23", endsOn: "2026-11-29")
            )
        }
    }

    @Test @MainActor func cargaElGrupoPorDefectoSinElVirtual() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/groups", .http(200, Self.grupos))
        servidor.fijar("GET /api/groups/dermatologia/members", .http(200, Self.miembros))
        servidor.fijar("GET /api/groups/dermatologia/shifts", .http(200, Self.turnos))
        let cepi = api(servidor)
        let modelo = ShiftsModel()

        await modelo.loadGroups(api: cepi)
        #expect(modelo.groups.map(\.slug) == ["turno", "dermatologia"])
        #expect(modelo.selectedGroup == "dermatologia")

        await modelo.load(api: cepi)
        #expect(modelo.error == nil)
        #expect(modelo.today == "2026-11-11")
        #expect(modelo.weeks.count == 8)
        #expect(modelo.weeks[0].start == "2026-11-09")
        #expect(modelo.onCallText == "Dra. Ana")
        // u1 ya está esa semana: solo queda Luis para asignar.
        #expect(modelo.freeMembers(modelo.weeks[0]).map(\.usuario) == ["u2"])
        #expect(modelo.assignBlockReason(modelo.weeks[0]) == "Elige a quién asignar")
        modelo.selection[modelo.weeks[0].start] = "u2"
        #expect(modelo.assignBlockReason(modelo.weeks[0]) == nil)
    }

    @Test @MainActor func sinGrupoDePorDefectoTomaElPrimero() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/groups", .http(200, """
        {"ok":true,"data":[{"id":"g1","slug":"turno","name":"Turno","kind":"roster","member_count":3}]}
        """))
        let modelo = ShiftsModel()
        await modelo.loadGroups(api: api(servidor))
        #expect(modelo.selectedGroup == "turno")
    }

    @Test @MainActor func asignaYMuestraElAviso() async throws {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/groups", .http(200, Self.grupos))
        servidor.fijar("GET /api/groups/dermatologia/members", .http(200, Self.miembros))
        servidor.fijar("GET /api/groups/dermatologia/shifts", .http(200, Self.turnos))
        servidor.fijar("POST /api/groups/dermatologia/shifts", .http(201, Self.creado),
                       .http(400, #"{"ok":false,"error":"La persona no es de la organización"}"#))
        let cepi = api(servidor)
        let modelo = ShiftsModel()
        await modelo.loadGroups(api: cepi)
        await modelo.load(api: cepi)

        let semana = modelo.weeks[2]
        modelo.selection[semana.start] = "u2"
        await modelo.assign(semana, api: cepi)
        #expect(modelo.notice == "Dr. Luis quedó de turno la semana del 23 nov – 29 nov")
        #expect(!modelo.noticeIsError)
        #expect(modelo.selection[semana.start] == nil)
        #expect(!modelo.busy)
        let cuerpo = try #require(servidor.cuerpo(de: "POST /api/groups/dermatologia/shifts"))
        let json = try #require(try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any])
        #expect(json["starts_on"] as? String == "2026-11-23")
        #expect(json["ends_on"] as? String == "2026-11-29")

        modelo.selection[semana.start] = "u2"
        await modelo.assign(semana, api: cepi)
        #expect(modelo.noticeIsError)
        #expect(modelo.notice == "No se pudo guardar: La persona no es de la organización")
    }

    @Test @MainActor func siElHoyDelServidorEsOtraSemanaVuelveAPedir() async {
        let servidor = ServidorFalso()
        defer { servidor.retirar() }
        servidor.fijar("GET /api/groups", .http(200, Self.grupos))
        servidor.fijar("GET /api/groups/dermatologia/members", .http(200, Self.miembros))
        // El servidor dice un «hoy» lejano de la fecha del dispositivo: la segunda respuesta
        // es la del rango correcto.
        servidor.fijar("GET /api/groups/dermatologia/shifts",
                       .http(200, #"{"ok":true,"data":[],"from":"x","to":"y","today":"2030-01-02"}"#),
                       .http(200, #"{"ok":true,"data":[],"from":"2029-12-31","to":"2030-02-24","today":"2030-01-02"}"#))
        let cepi = api(servidor)
        let modelo = ShiftsModel()
        await modelo.loadGroups(api: cepi)
        await modelo.load(api: cepi)
        #expect(servidor.pedidos.filter { $0 == "GET /api/groups/dermatologia/shifts" }.count == 2)
        #expect(modelo.today == "2030-01-02")
        #expect(modelo.weeks.first?.start == "2029-12-31")
        #expect(modelo.onCallText == "nadie asignado (avisa a todo el grupo)")
        #expect(modelo.weeks.allSatisfy { $0.shifts.isEmpty })
    }
}
