import Foundation
import Observation

/// Un paciente: su hilo con los mensajes de todos, la ficha que se va llenando y lo que se le
/// manda al asistente. Espejo de IntakeChat.vue: se escribe en la sesión propia y, tras cada
/// turno, se relee el hilo para que el iPhone y la web muestren lo mismo (PAPER §24.4).
@MainActor
@Observable
final class HiloModelo {
    let pacienteId: String
    private(set) var mensajes: [MensajeHilo] = []
    private(set) var pendiente: AccionPendiente?
    private(set) var respuestasRapidas: [RespuestaRapida] = []
    private(set) var episodioActivo: String?
    /// A quién está derivada la consulta activa ahora mismo (revisiones pendientes).
    private(set) var derivados: [Derivado] = []
    private(set) var pagina: PaginaHilo = .masNueva
    /// El episodio elegido en el navegador que todavía espera su turno (PAPER §28.4.1): el
    /// chat estaba ocupado. Se aplica al terminar; si se elige otro antes, gana el último.
    private(set) var episodioPedido: String?
    /// El episodio que se está cambiando ahora (`episode_switch` en vuelo).
    private(set) var episodioEnCambio: String?
    private(set) var ocupado = false
    private(set) var subiendo = false
    private(set) var adjunto: Adjunto?
    /// El grupo de la ficha que se está llenando, o nada.
    private(set) var formulario: FormularioBot?
    private(set) var marcadores: [Marcador] = []
    /// Encendido: tras abrir y tras cada guardado se muestra el siguiente grupo sin completar.
    /// Apagado (por defecto): solo el grupo pedido en "Secciones". Es de cada paciente.
    private(set) var autoFormulario: Bool
    var error: String?
    /// El hilo guardado llegó al menos una vez. Hasta entonces la pantalla dice "Cargando…" y
    /// no "Sin consultas todavía", que se leía como que el paciente no tenía ficha.
    private(set) var cargado = false
    @ObservationIgnored private var sesionId: String?
    /// La apertura en curso o terminada; ver `abrir`.
    @ObservationIgnored private var apertura: Task<Void, Never>?

    init(pacienteId: String) {
        self.pacienteId = pacienteId
        autoFormulario = UserDefaults.standard.bool(forKey: Self.claveAutoFormulario(pacienteId))
    }

    static func claveAutoFormulario(_ paciente: String) -> String {
        "cepi.autoform.\(paciente)"
    }

    /// El episodio cuyo contenido muestra el chat: lo último elegido, aunque el bot todavía no
    /// lo haya confirmado.
    var episodioALaVista: String? { episodioPedido ?? episodioEnCambio ?? episodioActivo }

    var episodios: Episodios { Episodios(mensajes: mensajes, activo: episodioActivo, aLaVista: episodioALaVista) }

    /// Al abrir: reanuda la sesión abierta propia (o crea una) activando al paciente. El bot
    /// saluda y dice qué falta de la ficha sin pasar por el LLM.
    ///
    /// Corre en una tarea del MODELO, no en la de la vista: en iPhone, al abrir otro paciente
    /// SwiftUI cancela y relanza el `.task` de la vista. Con la apertura atada a esa tarea, la
    /// primera corrida quedaba cancelada a mitad y la segunda salía por "ya está abierto": el
    /// hilo se quedaba en "Cargando la información…" para siempre. Ahora la segunda llamada
    /// espera a la misma apertura.
    func abrir(api: CEPIAPI) async {
        if apertura == nil {
            apertura = Task { await activar(api: api) }
        }
        await apertura?.value
    }

    private func activar(api: CEPIAPI) async {
        // Lo guardado se pide ya, en paralelo con la activación del bot (que en producción
        // tarda): así se ve lo que hay en cuanto llega, sin esperar al saludo.
        async let historial: Void = releer(api: api)
        ocupado = true
        defer { seguirConElCambioPendiente(api: api) }
        defer { ocupado = false }
        do {
            let propia = try? await api.sesionesBot(paciente: pacienteId)
                .first { $0.pacienteActivo == pacienteId && $0.estado == "abierta" }
            aplicar(try await api.chat("activar paciente \(pacienteId)", sesion: propia?.id))
            await historial
            await releer(api: api)
        } catch {
            await historial
            self.error = error.localizedDescription
        }
    }

    /// Envía un mensaje (con la foto adjunta, si hay). Devuelve si el bot lo procesó.
    /// `accionExplicita`: lo disparó un botón (derivar), así que el bot no pide sí/no.
    @discardableResult
    func enviar(_ texto: String, api: CEPIAPI, accionExplicita: Bool = false) async -> Bool {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        var mensaje = limpio
        if let adjunto {
            mensaje = (limpio.isEmpty ? "" : limpio + "\n") + "[adjunto: \(adjunto.nombre) · \(adjunto.id)]"
        }
        guard !mensaje.isEmpty, !ocupado else { return false }
        adjunto = nil
        // Un botón (Nueva consulta, derivar…) pidió esto: el formulario que traiga la respuesta
        // se muestra aunque «Auto» esté apagado, igual que al pedir una sección.
        return await turno(eco: mensaje, explicito: accionExplicita, api: api) { sesion in
            try await api.chat(mensaje, sesion: sesion, explicito: accionExplicita)
        }
    }

    /// Un envío estructurado: un grupo de la ficha, "ir a sección" o guardar el visor.
    @discardableResult
    func enviarFormulario(
        _ id: String, datos: [String: JSONValor], episodio: String? = nil, explicito: Bool = false, api: CEPIAPI
    ) async -> Bool {
        await turno(eco: nil, explicito: explicito, api: api) { sesion in
            try await api.enviarFormulario(id, datos: datos, sesion: sesion, episodio: episodio)
        }
    }

    /// Lo pedido en "Secciones" se muestra siempre, aunque el auto-form esté apagado.
    func abrirSeccion(_ marcador: Marcador, api: CEPIAPI) async {
        await enviarFormulario("ficha_goto", datos: ["group": .texto(marcador.id)], explicito: true, api: api)
    }

    func cerrarFormulario() {
        formulario = nil
    }

    func alternarAutoFormulario(api: CEPIAPI) async {
        autoFormulario.toggle()
        UserDefaults.standard.set(autoFormulario, forKey: Self.claveAutoFormulario(pacienteId))
        // Encenderlo arranca por la primera sección pendiente.
        if autoFormulario, let siguiente = marcadores.first(where: { !$0.hecho }) {
            await abrirSeccion(siguiente, api: api)
        }
    }

    func subir(_ jpeg: Data, nombre: String, api: CEPIAPI) async {
        subiendo = true
        error = nil
        defer { subiendo = false }
        do {
            adjunto = try await api.subirImagen(jpeg, nombre: nombre)
        } catch {
            self.error = "No se pudo subir la foto: \(error.localizedDescription)"
        }
    }

    func quitarAdjunto() {
        adjunto = nil
    }

    func releer(api: CEPIAPI) async {
        do {
            mensajes = try await api.hilo(paciente: pacienteId)
            cargado = true
            await releerDerivaciones(api: api)
        } catch {
            if !Task.isCancelled { self.error = "No se pudo cargar el hilo: \(error.localizedDescription)" }
        }
    }

    /// Quién tiene pendiente esta consulta. Un fallo acá no molesta al hilo: se muestra sin
    /// la barra de "derivado a…" y se reintenta en la próxima relectura.
    func releerDerivaciones(api: CEPIAPI) async {
        guard let episodio = episodioActivo else { derivados = []; return }
        derivados = (try? await api.derivaciones(episodio: episodio)) ?? []
    }

    func volverALaActual() {
        pagina = .consulta(episodioActivo)
    }

    /// Cambia el chat a otro episodio desde el navegador (PAPER §28.4.1). Es navegar, no
    /// conversar: el contenido cambia ya (la página de ese episodio, vacía si no tiene
    /// mensajes) y el bot lo activa con `episode_switch`, sin eco ni turno en el hilo. Si el
    /// chat está ocupado, el cambio queda pedido y se aplica al terminar; gana el último.
    func cambiarEpisodio(_ id: String, api: CEPIAPI) async {
        guard id != episodioALaVista else {
            pagina = .consulta(id)
            return
        }
        episodioPedido = id
        pagina = .consulta(id)
        await aplicarCambioPendiente(api: api)
    }

    private func aplicarCambioPendiente(api: CEPIAPI) async {
        while !ocupado, let id = episodioPedido {
            episodioPedido = nil
            // Volver al que ya está activo no necesita al bot.
            if id == episodioActivo {
                pagina = .consulta(id)
                continue
            }
            episodioEnCambio = id
            let hecho = await turno(eco: nil, explicito: false, api: api) { sesion in
                try await api.enviarFormulario("episode_switch", datos: ["episode_id": .texto(id)], sesion: sesion)
            }
            episodioEnCambio = nil
            // Si el bot lo rechazó (404: no es de este paciente), el chat vuelve al activo.
            if !hecho, episodioPedido == nil { pagina = .consulta(episodioActivo) }
        }
    }

    /// Al terminar un turno, el cambio de episodio que esperaba se aplica. En una tarea aparte:
    /// corre cuando `ocupado` ya volvió a `false`.
    private func seguirConElCambioPendiente(api: CEPIAPI) {
        guard episodioPedido != nil else { return }
        Task { await aplicarCambioPendiente(api: api) }
    }

    private func turno(
        eco: String?, explicito: Bool, api: CEPIAPI, _ ejecutar: (String?) async throws -> RespuestaChat
    ) async -> Bool {
        guard !ocupado else { return false }
        error = nil
        respuestasRapidas = []
        if let eco { mensajes.append(MensajeHilo(eco: eco, episodio: episodioActivo)) }
        ocupado = true
        // Los `defer` corren al revés: primero se libera `ocupado`, después sigue el cambio pedido.
        defer { seguirConElCambioPendiente(api: api) }
        defer { ocupado = false }
        var procesado = true
        do {
            // La sesión propia se crea recién al primer envío: mirar un paciente no la crea.
            if sesionId == nil {
                aplicar(try await api.chat("activar paciente \(pacienteId)", sesion: nil))
            }
            aplicar(try await ejecutar(sesionId), explicito: explicito)
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
            procesado = false
        }
        // Tras un éxito trae el turno ya atribuido; tras un fallo quita el eco, para que no
        // quede un mensaje "enviado" al lado del error.
        await releer(api: api)
        return procesado
    }

    private func aplicar(_ respuesta: RespuestaChat, explicito: Bool = false) {
        if let id = respuesta.sessionId { sesionId = id }
        if respuesta.traePendiente { pendiente = respuesta.pendiente }
        respuestasRapidas = respuesta.respuestasRapidas
        if respuesta.traeFormulario {
            formulario = (explicito || autoFormulario) ? respuesta.formulario : nil
        }
        if let marcadores = respuesta.marcadores { self.marcadores = marcadores }
        if respuesta.traeEpisodioActivo {
            episodioActivo = respuesta.episodioActivo
            // Abrir, enviar o abrir consulta nueva lleva a mirar la consulta activa, salvo que en
            // el navegador ya se haya elegido otra (pedida o cambiándose): esa se sigue viendo.
            pagina = .consulta(episodioPedido ?? episodioEnCambio ?? respuesta.episodioActivo)
        }
    }
}
