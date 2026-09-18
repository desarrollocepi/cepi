import Foundation
import Observation

/// Las imágenes clínicas que se ven en una rejilla: la galería de la organización o las de un
/// paciente (PAPER §24.2.1). Pide de a páginas y espera un momento antes de buscar, para no
/// mandar una consulta por tecla.
@MainActor
@Observable
final class GaleriaModelo {
    /// Solo las de este paciente; `nil` = todas las de la organización activa.
    let paciente: String?

    private(set) var imagenes: [ImagenGaleria] = []
    private(set) var total: Int?
    private(set) var cargando = false
    private(set) var cargado = false
    private(set) var error: String?

    @ObservationIgnored private var pedido = 0
    @ObservationIgnored private var busquedaAplicada = ""

    private static let porPagina = 60

    init(paciente: String? = nil) {
        self.paciente = paciente
    }

    var hayMas: Bool {
        guard let total else { return false }
        return imagenes.count < total
    }

    /// Texto que se está mostrando; cambia solo cuando la búsqueda ya se aplicó.
    var busqueda: String { busquedaAplicada }

    /// Llamado desde `.task(id: busqueda)`: espera un momento (la tecla siguiente cancela la
    /// tarea) y recarga desde cero.
    func buscar(_ texto: String, api: CEPIAPI, esperar: Duration = .milliseconds(350)) async {
        let limpio = texto.trimmingCharacters(in: .whitespaces)
        if limpio != busquedaAplicada, !limpio.isEmpty || cargado {
            try? await Task.sleep(for: esperar)
            guard !Task.isCancelled else { return }
        }
        busquedaAplicada = limpio
        await cargar(api: api, desde: 0)
    }

    func siguientePagina(api: CEPIAPI) async {
        guard hayMas, !cargando else { return }
        await cargar(api: api, desde: imagenes.count)
    }

    func recargar(api: CEPIAPI) async {
        await cargar(api: api, desde: 0)
    }

    private func cargar(api: CEPIAPI, desde: Int) async {
        pedido += 1
        let mio = pedido
        cargando = true
        defer { if mio == pedido { cargando = false } }
        do {
            let pagina = try await api.galeria(
                texto: busquedaAplicada, paciente: paciente, limite: Self.porPagina, desde: desde
            )
            guard mio == pedido else { return }   // llegó otra búsqueda más nueva
            imagenes = desde == 0 ? pagina.data : imagenes + pagina.data
            total = pagina.total
            error = nil
            cargado = true
        } catch {
            guard mio == pedido, !Task.isCancelled else { return }
            // Un fallo al pedir "más" no borra lo que ya se está viendo.
            if desde == 0 { imagenes = [] }
            self.error = error.localizedDescription
        }
    }
}
