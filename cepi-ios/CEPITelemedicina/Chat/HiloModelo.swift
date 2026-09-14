import Foundation
import Observation

/// Un paciente: su hilo con los mensajes de todos y lo que se le manda al asistente. Espejo de
/// IntakeChat.vue: se escribe en la sesión propia y, tras cada turno, se relee el hilo para
/// que el iPhone y la web muestren exactamente lo mismo (PAPER §24.4).
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
    var error: String?
    @ObservationIgnored private var sesionId: String?
    @ObservationIgnored private var abierto = false

    init(pacienteId: String) {
        self.pacienteId = pacienteId
    }

    var episodios: Episodios { Episodios(mensajes: mensajes, activo: episodioActivo) }

    /// Al abrir: reanuda la sesión abierta propia (o crea una) activando al paciente. El bot
    /// saluda y dice qué falta de la ficha sin pasar por el LLM.
    func abrir(api: CEPIAPI) async {
        guard !abierto else { return }
        abierto = true
        ocupado = true
        defer { ocupado = false }
        do {
            let propia = try? await api.sesionesBot(paciente: pacienteId)
                .first { $0.pacienteActivo == pacienteId && $0.estado == "abierta" }
            aplicar(try await api.chat("activar paciente \(pacienteId)", sesion: propia?.id))
            await releer(api: api)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func enviar(_ texto: String, api: CEPIAPI) async {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        var mensaje = limpio
        if let adjunto {
            mensaje = (limpio.isEmpty ? "" : limpio + "\n") + "[adjunto: \(adjunto.nombre) · \(adjunto.id)]"
        }
        guard !mensaje.isEmpty, !ocupado else { return }
        adjunto = nil
        error = nil
        respuestasRapidas = []
        mensajes.append(MensajeHilo(eco: mensaje, episodio: episodioActivo))
        ocupado = true
        defer { ocupado = false }
        do {
            if sesionId == nil {
                aplicar(try await api.chat("activar paciente \(pacienteId)", sesion: nil))
            }
            aplicar(try await api.chat(mensaje, sesion: sesionId))
        } catch {
            self.error = error.localizedDescription
        }
        // Tras un éxito trae el turno ya atribuido; tras un fallo quita el eco, para que no
        // quede un mensaje "enviado" al lado del error.
        await releer(api: api)
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
        } catch {
            self.error = "No se pudo cargar el hilo: \(error.localizedDescription)"
        }
    }

    func irAnterior() { mover(-1) }

    func irSiguiente() { mover(1) }

    func volverALaActual() {
        pagina = .consulta(episodioActivo)
    }

    private func mover(_ paso: Int) {
        let actuales = episodios
        let destino = actuales.indice(de: pagina) + paso
        guard actuales.orden.indices.contains(destino) else { return }
        pagina = .consulta(actuales.orden[destino])
    }

    private func aplicar(_ respuesta: RespuestaChat) {
        if let id = respuesta.sessionId { sesionId = id }
        if respuesta.traePendiente { pendiente = respuesta.pendiente }
        respuestasRapidas = respuesta.respuestasRapidas
        if respuesta.traeEpisodioActivo {
            episodioActivo = respuesta.episodioActivo
            // Abrir, enviar o abrir consulta nueva lleva a mirar la consulta activa.
            pagina = .consulta(respuesta.episodioActivo)
        }
    }
}
