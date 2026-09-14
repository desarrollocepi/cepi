import Foundation
import Observation

/// Una fila de la lista con lo que la búsqueda y la vista necesitan ya calculado: se arma
/// una vez por carga, no una vez por tecla ni por render.
struct FilaPaciente: Identifiable, Sendable, Hashable {
    let registro: Registro
    let nombre: String
    let cedula: String?
    let iniciales: String
    /// Nombre y cédula sin mayúsculas ni tildes: "jose" encuentra a "José".
    let claveBusqueda: String

    var id: String { registro.id }

    init(_ registro: Registro) {
        self.registro = registro
        let completo = [registro["nombre"], registro["apellidos"]].compactMap { $0 }.joined(separator: " ")
        nombre = completo.isEmpty ? (registro.title ?? "Paciente") : completo
        cedula = registro["cedula"]
        iniciales = nombre.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        claveBusqueda = FilaPaciente.normalizar("\(nombre) \(cedula ?? "")")
    }

    static func normalizar(_ texto: String) -> String {
        texto.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "es"))
    }
}

@MainActor
@Observable
final class PacientesModelo {
    private(set) var filas: [FilaPaciente] = []
    private(set) var revision: [String: PendienteRevision] = [:]
    private(set) var asignaciones: [String: Asignacion] = [:]
    private(set) var cargado = false
    private(set) var error: String?
    private var porId: [String: FilaPaciente] = [:]
    private var cargando = false

    func fila(_ id: String) -> FilaPaciente? { porId[id] }

    /// Pacientes, "revisar" y a cargo en paralelo (la web los pide en serie). Si fallan los
    /// dos accesorios se conserva lo anterior: un error transitorio no debe borrar los
    /// avisos de "revisar".
    func cargar(api: CEPIAPI) async {
        guard !cargando else { return }
        cargando = true
        defer { cargando = false }

        async let pacientes = api.pacientes()
        async let cola = try? api.colaRevision()
        async let asignados = try? api.asignaciones()
        do {
            let registros = try await pacientes
            if let nueva = await cola { revision = nueva }
            if let nuevas = await asignados { asignaciones = nuevas }
            let nuevasFilas = await Self.preparar(registros, revision: revision)
            filas = nuevasFilas
            porId = Dictionary(nuevasFilas.map { ($0.id, $0) }, uniquingKeysWith: { primera, _ in primera })
            error = nil
            cargado = true
        } catch {
            // En los refrescos periódicos un fallo no pisa la lista; solo se muestra si
            // nunca llegó a cargar.
            if !cargado { self.error = error.localizedDescription }
        }
    }

    /// Un paciente recién creado aparece ya, sin esperar a la próxima recarga.
    func insertar(_ registro: Registro) {
        guard porId[registro.id] == nil else { return }
        let fila = FilaPaciente(registro)
        filas.insert(fila, at: 0)
        porId[fila.id] = fila
    }

    func filtradas(por busqueda: String) -> [FilaPaciente] {
        let consulta = FilaPaciente.normalizar(busqueda.trimmingCharacters(in: .whitespaces))
        guard !consulta.isEmpty else { return filas }
        return filas.filter { $0.claveBusqueda.contains(consulta) }
    }

    /// Fuera del hilo principal: normalizar y ordenar 500 filas no debe costar un frame.
    nonisolated static func preparar(
        _ registros: [Registro], revision: [String: PendienteRevision]
    ) async -> [FilaPaciente] {
        ordenar(registros.map(FilaPaciente.init), revision: revision)
    }

    /// Primero lo derivado a quien consulta, lo que vence antes arriba; el resto conserva el
    /// orden del servidor. Misma regla que `filtered` en ChatList.vue.
    nonisolated static func ordenar(
        _ filas: [FilaPaciente], revision: [String: PendienteRevision]
    ) -> [FilaPaciente] {
        let vence = revision.mapValues { Fechas.iso($0.vence) ?? .distantFuture }
        return filas.enumerated().sorted { a, b in
            switch (vence[a.element.id], vence[b.element.id]) {
            case (.some, .none):
                return true
            case (.none, .some):
                return false
            case let (.some(va), .some(vb)) where va != vb:
                return va < vb
            default:
                return a.offset < b.offset
            }
        }.map(\.element)
    }
}
