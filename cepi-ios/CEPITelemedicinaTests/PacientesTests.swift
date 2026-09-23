import Foundation
import Testing
@testable import CEPITelemedicina

struct PacientesTests {
    private func registro(
        _ id: String, nombre: String? = nil, apellidos: String? = nil, cedula: String? = nil, title: String? = nil
    ) throws -> Registro {
        var data: [String: Any] = [:]
        if let nombre { data["nombre"] = nombre }
        if let apellidos { data["apellidos"] = apellidos }
        if let cedula { data["cedula"] = cedula }
        var objeto: [String: Any] = ["id": id, "data": data]
        if let title { objeto["title"] = title }
        return try JSONDecoder().decode(Registro.self, from: JSONSerialization.data(withJSONObject: objeto))
    }

    @Test func revisarPrimeroYLoQueVenceAntes() throws {
        let filas = try ["a", "b", "c", "d", "e"].map { FilaPaciente(try registro($0, nombre: $0)) }
        let revision = [
            "c": PendienteRevision(pendientes: 1, vence: "2026-09-20T10:00:00.000Z"),
            "d": PendienteRevision(pendientes: 2, vence: "2026-09-15T10:00:00Z"),
            "e": PendienteRevision(pendientes: 1, vence: nil),
        ]
        let orden = PacientesModelo.ordenar(filas, revision: revision).map(\.id)
        #expect(orden == ["d", "c", "e", "a", "b"])
    }

    @Test func primeroPorEstadoYDentroDelEstadoRevisar() throws {
        let filas = try ["a", "b", "c", "d", "e", "f"].map { FilaPaciente(try registro($0, nombre: $0)) }
        let asignaciones = [
            "a": Asignacion(nombre: nil, origen: nil, estado: "cerrado"),
            "b": Asignacion(nombre: nil, origen: nil, estado: "respondida"),
            "c": Asignacion(nombre: nil, origen: nil, estado: "en_curso"),
            "e": Asignacion(nombre: nil, origen: nil, estado: "en_curso"),
            "f": Asignacion(nombre: nil, origen: nil, estado: "en_revisión_solicitada"),
        ]
        let revision = ["e": PendienteRevision(pendientes: 1, vence: nil)]
        let orden = PacientesModelo.ordenar(filas, revision: revision, asignaciones: asignaciones).map(\.id)
        #expect(orden == ["b", "f", "e", "c", "a", "d"])
    }

    @Test func estadoDeLaFicha() {
        #expect(EstadoFicha(nil) == .sinConsulta)
        #expect(EstadoFicha(" ") == .sinConsulta)
        #expect(EstadoFicha("derivada") == .derivada)
        #expect(EstadoFicha("en_revisión_solicitada") == .revisionSolicitada)
        #expect(EstadoFicha("agendado") == .agendada)
        // Un estado que la app no conoce no rompe la lista: cae en "Otro estado".
        #expect(EstadoFicha("archivada") == .otro)
    }

    @Test func busquedaSinTildesNiMayusculas() throws {
        let fila = FilaPaciente(try registro("p", nombre: "José", apellidos: "Núñez", cedula: "0912345678"))
        #expect(fila.claveBusqueda.contains(FilaPaciente.normalizar("JOSE nunez")))
        #expect(fila.claveBusqueda.contains("0912"))
        #expect(fila.iniciales == "JN")
    }

    @Test func sinNombreUsaElTitulo() throws {
        let fila = FilaPaciente(try registro("p", title: "Paciente importado"))
        #expect(fila.nombre == "Paciente importado")
        #expect(fila.cedula == nil)
    }
}
