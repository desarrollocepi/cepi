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
                registros, revision: nuevaCola ?? revision, asignaciones: nuevasAsignaciones ?? asignaciones
            )
            guard mio == pedido else { return }   // llegó otra carga más nueva (otra org)
            if let nuevaCola { revision = nuevaCola }
            if let nuevasAsignaciones { asignaciones = nuevasAsignaciones }
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

    /// Por texto (nombre o cédula, sin tildes) y, si se eligió, por estado de la ficha.
    func filtradas(por busqueda: String, estado: EstadoFicha? = nil) -> [FilaPaciente] {
        let consulta = FilaPaciente.normalizar(busqueda.trimmingCharacters(in: .whitespaces))
        guard !consulta.isEmpty || estado != nil else { return filas }
        return filas.filter { fila in
            (consulta.isEmpty || fila.claveBusqueda.contains(consulta))
                && (estado == nil || self.estado(fila.id) == estado)
        }
    }

    /// Cuántos pacientes hay en cada estado: el filtro los muestra y deshabilita los vacíos.
    func conteoPorEstado() -> [EstadoFicha: Int] {
        filas.reduce(into: [:]) { conteo, fila in conteo[estado(fila.id), default: 0] += 1 }
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
