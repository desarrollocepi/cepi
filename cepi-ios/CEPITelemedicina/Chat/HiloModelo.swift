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
    private(set) var pagina: PaginaHilo = .masNueva
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
    @ObservationIgnored private var abierto = false

    init(pacienteId: String) {
        self.pacienteId = pacienteId
        autoFormulario = UserDefaults.standard.bool(forKey: Self.claveAutoFormulario(pacienteId))
    }

    static func claveAutoFormulario(_ paciente: String) -> String {
        "cepi.autoform.\(paciente)"
    }

    var episodios: Episodios { Episodios(mensajes: mensajes, activo: episodioActivo) }

    /// Al abrir: reanuda la sesión abierta propia (o crea una) activando al paciente. El bot
    /// saluda y dice qué falta de la ficha sin pasar por el LLM.
    func abrir(api: CEPIAPI) async {
        guard !abierto else { return }
        abierto = true
        // Lo guardado se pide ya, en paralelo con la activación del bot (que en producción
        // tarda): así se ve lo que hay en cuanto llega, sin esperar al saludo.
        async let historial: Void = releer(api: api)
        ocupado = true
        defer { ocupado = false }
        do {
            let propia = try? await api.sesionesBot(paciente: pacienteId)
                .first { $0.pacienteActivo == pacienteId && $0.estado == "abierta" }
            aplicar(try await api.chat("activar paciente \(pacienteId)", sesion: propia?.id))
            await historial
            await releer(api: api)
        } catch {
            await historial
            // Salir del paciente cancela la tarea: no es un error y hay que poder reabrirlo.
            if Task.isCancelled { abierto = false; return }
            self.error = error.localizedDescription
        }
    }

    /// Envía un mensaje (con la foto adjunta, si hay). Devuelve si el bot lo procesó.
    @discardableResult
    func enviar(_ texto: String, api: CEPIAPI) async -> Bool {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        var mensaje = limpio
        if let adjunto {
            mensaje = (limpio.isEmpty ? "" : limpio + "\n") + "[adjunto: \(adjunto.nombre) · \(adjunto.id)]"
        }
        guard !mensaje.isEmpty, !ocupado else { return false }
        adjunto = nil
        return await turno(eco: mensaje, explicito: false, api: api) { sesion in
            try await api.chat(mensaje, sesion: sesion)
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

    /// Quien tiene el caso: el responsable (lo reclamó o se le asignó) o, si no hay, quien lo creó.
    func responsableDelCaso(api: CEPIAPI) async -> String? {
        guard let episodio = episodioActivo, let registro = try? await api.entidad(episodio) else { return nil }
        return registro["responsable_actual_id"] ?? registro["medico_id"]
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
        } catch {
            if !Task.isCancelled { self.error = "No se pudo cargar el hilo: \(error.localizedDescription)" }
        }
    }

    func irAnterior() { mover(-1) }

    func irSiguiente() { mover(1) }

    func volverALaActual() {
        pagina = .consulta(episodioActivo)
    }

    private func turno(
        eco: String?, explicito: Bool, api: CEPIAPI, _ ejecutar: (String?) async throws -> RespuestaChat
    ) async -> Bool {
        guard !ocupado else { return false }
        error = nil
        respuestasRapidas = []
        if let eco { mensajes.append(MensajeHilo(eco: eco, episodio: episodioActivo)) }
        ocupado = true
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

    private func mover(_ paso: Int) {
        let actuales = episodios
        let destino = actuales.indice(de: pagina) + paso
        guard actuales.orden.indices.contains(destino) else { return }
        pagina = .consulta(actuales.orden[destino])
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
            // Abrir, enviar o abrir consulta nueva lleva a mirar la consulta activa.
            pagina = .consulta(respuesta.episodioActivo)
        }
    }
}
