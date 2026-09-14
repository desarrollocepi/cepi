import Foundation
import Testing
@testable import CEPITelemedicina

/// Respuestas reales del bot, del hilo y de adjuntos, capturadas del stack local
/// (PAPER §24.4).
struct ChatContratoTests {
    private func decodificar<T: Decodable>(_ tipo: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(tipo, from: Data(json.utf8))
    }

    @Test func activacionTraeConsultaSinPendiente() throws {
        let respuesta = try decodificar(RespuestaChat.self, """
        {"ok":true,"session_id":"465745e9-4100-4b85-b58f-9d0a761626d2","text":"Paciente activo: Valentina Castro Reyes",
         "history":[],"toolCalls":[],"active_patient_id":"11000000-0000-0000-1000-000000000009",
         "active_episode_id":"528a71b8-e7c0-4e0a-b059-f7d4fb672b90","status_header":"👤 Valentina Castro Reyes",
         "form":{"id":"ficha_grp_g_1_4","title":"1.4 Etnia","submit_mode":"structured",
                 "fields":[{"key":"etnia","label":"Etnia","type":"radio","options":["mestiza","blanco"]}]},
         "bookmarks":[{"id":"g_1_1","label":"1.1 Datos de contacto","category":"Filiación","done":true,"conDato":true}]}
        """)
        #expect(respuesta.sessionId == "465745e9-4100-4b85-b58f-9d0a761626d2")
        #expect(respuesta.traeEpisodioActivo)
        #expect(respuesta.episodioActivo == "528a71b8-e7c0-4e0a-b059-f7d4fb672b90")
        #expect(!respuesta.traePendiente)
        #expect(respuesta.respuestasRapidas.isEmpty)
    }

    @Test func adjuntoPideRespuestaRapida() throws {
        let respuesta = try decodificar(RespuestaChat.self, """
        {"ok":true,"session_id":"s1","text":"¿Esta imagen es de la lesión o un formulario de consentimiento?",
         "history":[],"toolCalls":[],"active_patient_id":"p1","active_episode_id":null,
         "quick_replies":[{"label":"🔬 Imagen de lesión","send":"imagen lesion"},
                          {"label":"📄 Consentimiento","send":"imagen consentimiento"}]}
        """)
        #expect(respuesta.respuestasRapidas.map(\.send) == ["imagen lesion", "imagen consentimiento"])
        #expect(respuesta.traeEpisodioActivo)
        #expect(respuesta.episodioActivo == nil)
    }

    @Test func pendienteNuloNoEsPendienteAusente() throws {
        let nulo = try decodificar(RespuestaChat.self, #"{"ok":true,"session_id":"s","pending_action":null}"#)
        #expect(nulo.traePendiente)
        #expect(nulo.pendiente == nil)
        #expect(!nulo.traeEpisodioActivo)

        let conConfirmacion = try decodificar(RespuestaChat.self, """
        {"ok":true,"session_id":"s","pending_action":{"summary":"Crear episodio 'control'","tool":"entities.create",
         "args":{},"successMessage":"Listo","createdAt":"2026-09-14T20:00:00Z"}}
        """)
        #expect(conConfirmacion.pendiente?.summary == "Crear episodio 'control'")
    }

    @Test func mensajesDelHilo() throws {
        let hilo = try decodificar(HiloRespuesta.self, """
        {"ok":true,"patient_id":"p","me":{"id":"u4"},"messages":[
         {"session_id":"s","role":"user","content":"escalar a u1 Revisar lesión","author_id":"u4",
          "author_name":"Dra. Derma Dos","self":true,"is_bot":false,"ts":"2026-09-14T20:35:49.014Z",
          "episode_id":"e2","estado":"abierta"},
         {"session_id":"s","role":"assistant","content":"Episodio escalado.","author_id":"bot",
          "author_name":"Asistente","self":false,"is_bot":true,"ts":"2026-09-14T20:35:49.014Z",
          "episode_id":null,"estado":"abierta"}]}
        """)
        #expect(hilo.mensajes.count == 2)
        #expect(hilo.mensajes[0].propio && !hilo.mensajes[0].esBot)
        #expect(hilo.mensajes[0].fecha != nil)
        #expect(hilo.mensajes[1].esBot && hilo.mensajes[1].episodio == nil)
    }

    @Test func sesionesYAdjunto() throws {
        let sesiones = try decodificar(SesionesBot.self, """
        {"ok":true,"sessions":[{"id":"s1","title":"","created_at":"x","updated_at":"y","estado":"abierta",
         "active_patient_id":"p1","preview":"hola","patient_name":"Ana"}]}
        """)
        #expect(sesiones.sesiones.first?.pacienteActivo == "p1")

        let adjunto = try decodificar(Adjunto.self, """
        {"id":"1f61150b-40c5-4c08-9ea8-2588a271268d","entity_id":null,"field_key":null,"filename":"b9e4.jpg",
         "original_name":"lesion-prueba.jpg","mimetype":"image/jpeg","size":61253,"created_at":"2026-09-14T20:38:01.128Z"}
        """)
        #expect(adjunto.nombre == "lesion-prueba.jpg")
    }

    @Test func lasRutasDelBotVanAlBot() {
        let cliente = APIClient(
            base: URL(string: "http://127.0.0.1:3001")!,
            baseBot: URL(string: "http://127.0.0.1:3002")!,
            credenciales: Credenciales(cuenta: "tests")
        )
        #expect(cliente.url(para: "/api/bot/chat").absoluteString == "http://127.0.0.1:3002/api/bot/chat")
        #expect(cliente.url(para: "/api/patient-thread").absoluteString == "http://127.0.0.1:3001/api/patient-thread")
    }
}
