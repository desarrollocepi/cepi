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

/// El alcance de la lista (PAPER §39): lo mío o todo. Uno siempre está elegido.
enum PatientScope: Sendable, Hashable {
    case mine, all
}

@MainActor
@Observable
final class PacientesModelo {
    private(set) var filas: [FilaPaciente] = []
    private(set) var revision: [String: PendienteRevision] = [:]
    private(set) var asignaciones: [String: Asignacion] = [:]
    /// Los pacientes «míos» (PAPER §39): a cargo o alguna vez asignados a quien consulta.
    private(set) var mine: Set<String> = []
    private(set) var cargado = false
    private(set) var error: String?
    private var porId: [String: FilaPaciente] = [:]
    /// De qué org es lo que hay en `filas`.
    private var organizacion: String?
    /// Cada carga lleva un número; al volver solo se aplica la última. Antes una carga en
    /// curso bloqueaba la siguiente (`guard !cargando`): si se cambiaba de org justo durante
    /// un refresco, la lista de la org nueva no se pedía y la anterior quedaba hasta 20 s.
    private var pedido = 0

    func fila(_ id: String) -> FilaPaciente? { porId[id] }

    /// Pacientes, "revisar" y a cargo en paralelo (la web los pide en serie). Si fallan los
    /// dos accesorios se conserva lo anterior: un error transitorio no debe borrar los
    /// avisos de "revisar".
    func cargar(api: CEPIAPI) async {
        pedido += 1
        let mio = pedido

        async let pacientes = api.pacientes()
        async let cola = try? api.colaRevision()
        async let asignados = try? api.asignaciones()
        do {
            let registros = try await pacientes
            let nuevaCola = await cola
            let nuevasAsignaciones = await asignados
            let nuevasFilas = await Self.preparar(
                registros, revision: nuevaCola ?? revision,
                asignaciones: nuevasAsignaciones?.porPaciente ?? asignaciones
            )
            guard mio == pedido else { return }   // llegó otra carga más nueva (otra org)
            if let nuevaCola { revision = nuevaCola }
            if let nuevasAsignaciones {
                asignaciones = nuevasAsignaciones.porPaciente
                mine = Set(nuevasAsignaciones.mine)
            }
            filas = nuevasFilas
            porId = Dictionary(nuevasFilas.map { ($0.id, $0) }, uniquingKeysWith: { primera, _ in primera })
            error = nil
            cargado = true
        } catch {
            // En los refrescos periódicos un fallo no pisa la lista; solo se muestra si
            // nunca llegó a cargar.
            guard mio == pedido else { return }
            if !cargado, !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    /// Otra org es otra lista: se vacía y vuelve a "Cargando pacientes…" en vez de dejar a
    /// la vista, y tocable, la lista de la org anterior mientras llega la nueva.
    func usarOrganizacion(_ org: String?) {
        guard org != organizacion else { return }
        let habiaOtra = organizacion != nil
        organizacion = org
        guard habiaOtra else { return }
        pedido += 1   // lo que llegue de la org anterior se descarta
        filas = []
        porId = [:]
        revision = [:]
        asignaciones = [:]
        mine = []
        cargado = false
        error = nil
    }

    /// Un error de una acción de la lista (borrar), que se muestra donde el resto.
    func mostrarError(_ texto: String) {
        error = texto
    }

    /// Un paciente recién creado aparece ya, sin esperar a la próxima recarga.
    func insertar(_ registro: Registro) {
        guard porId[registro.id] == nil else { return }
        let fila = FilaPaciente(registro)
        filas.insert(fila, at: 0)
        porId[fila.id] = fila
    }

    func estado(_ id: String) -> EstadoFicha { EstadoFicha(asignaciones[id]?.estado) }

    /// Ver `filter(_:query:scope:state:mine:assignments:today:)`.
    func filtradas(
        por busqueda: String, estado: EstadoFicha? = nil, scope: PatientScope = .all,
        today: String = PacientesModelo.localToday()
    ) -> [FilaPaciente] {
        Self.filter(
            filas, query: busqueda, scope: scope, state: estado, mine: mine, assignments: asignaciones, today: today
        )
    }

    /// Por texto (nombre o cédula, sin tildes), por alcance y, si se eligió, por estado de la
    /// ficha (PAPER §39: alcance Y estado). Con texto se busca en todos, aunque el alcance sea
    /// «Mis pacientes»: a un paciente que no es mío se lo tiene que poder encontrar. Quien está
    /// de alta desde antes de `today` solo sale buscándolo o en el filtro «Alta» (PAPER §35).
    nonisolated static func filter(
        _ filas: [FilaPaciente], query: String, scope: PatientScope, state: EstadoFicha?,
        mine: Set<String>, assignments: [String: Asignacion], today: String
    ) -> [FilaPaciente] {
        let consulta = FilaPaciente.normalizar(query.trimmingCharacters(in: .whitespaces))
        let showDischarged = !consulta.isEmpty || state == .alta
        let effectiveScope: PatientScope = consulta.isEmpty ? scope : .all
        return filas.filter { fila in
            (consulta.isEmpty || fila.claveBusqueda.contains(consulta))
                && inScope(fila.id, effectiveScope, mine: mine)
                && (state == nil || EstadoFicha(assignments[fila.id]?.estado) == state)
                && (showDischarged || assignments[fila.id]?.dischargeExpired(today: today) != true)
        }
    }

    nonisolated static func inScope(_ id: String, _ scope: PatientScope, mine: Set<String>) -> Bool {
        scope == .all || mine.contains(id)
    }

    /// Cuántos pacientes entran en cada alcance: «Mis pacientes · N» y «Todos · M».
    nonisolated static func scopeCounts(_ filas: [FilaPaciente], mine: Set<String>) -> [PatientScope: Int] {
        [.mine: filas.filter { mine.contains($0.id) }.count, .all: filas.count]
    }

    /// Cuántos pacientes hay en cada estado dentro del alcance elegido.
    nonisolated static func stateCounts(
        _ filas: [FilaPaciente], scope: PatientScope, mine: Set<String>, assignments: [String: Asignacion]
    ) -> [EstadoFicha: Int] {
        filas.reduce(into: [:]) { conteo, fila in
            guard inScope(fila.id, scope, mine: mine) else { return }
            conteo[EstadoFicha(assignments[fila.id]?.estado), default: 0] += 1
        }
    }

    /// Fecha local del dispositivo (`YYYY-MM-DD`). En UTC, de noche en Ecuador ya es mañana.
    nonisolated static func localToday(_ date: Date = .now, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Cuántos pacientes hay en cada estado dentro del alcance: el filtro los muestra y
    /// deshabilita los vacíos.
    func conteoPorEstado(scope: PatientScope = .all) -> [EstadoFicha: Int] {
        Self.stateCounts(filas, scope: scope, mine: mine, assignments: asignaciones)
    }

    func conteoPorAlcance() -> [PatientScope: Int] {
        Self.scopeCounts(filas, mine: mine)
    }

    /// Fuera del hilo principal: normalizar y ordenar 500 filas no debe costar un frame.
    nonisolated static func preparar(
        _ registros: [Registro], revision: [String: PendienteRevision], asignaciones: [String: Asignacion] = [:]
    ) async -> [FilaPaciente] {
        ordenar(registros.map(FilaPaciente.init), revision: revision, asignaciones: asignaciones)
    }

    /// Por estado de la ficha (el orden de `EstadoFicha`). Dentro de un mismo estado, primero
    /// lo derivado a quien consulta, lo que vence antes arriba (la regla de `filtered` en
    /// ChatList.vue); el resto conserva el orden del servidor.
    nonisolated static func ordenar(
        _ filas: [FilaPaciente], revision: [String: PendienteRevision], asignaciones: [String: Asignacion] = [:]
    ) -> [FilaPaciente] {
        let vence = revision.mapValues { Fechas.iso($0.vence) ?? .distantFuture }
        let conEstado = filas.enumerated().map { indice, fila in
            (fila: fila, orden: indice, estado: EstadoFicha(asignaciones[fila.id]?.estado).rawValue)
        }
        return conEstado.sorted { a, b in
            if a.estado != b.estado { return a.estado < b.estado }
            switch (vence[a.fila.id], vence[b.fila.id]) {
            case (.some, .none):
                return true
            case (.none, .some):
                return false
            case let (.some(va), .some(vb)) where va != vb:
                return va < vb
            default:
                return a.orden < b.orden
            }
        }.map(\.fila)
    }
}
