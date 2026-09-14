import Foundation
import Testing
@testable import CEPITelemedicina

struct EpisodiosTests {
    private func mensaje(
        _ contenido: String, episodio: String?, propio: Bool = false, bot: Bool = true, autor: String = "bot"
    ) throws -> MensajeHilo {
        let objeto: [String: Any] = [
            "role": propio ? "user" : "assistant",
            "content": contenido,
            "self": propio,
            "is_bot": bot,
            "author_id": autor,
            "ts": "2026-09-14T20:35:49.014Z",
            "episode_id": episodio ?? NSNull(),
        ]
        return try JSONDecoder().decode(MensajeHilo.self, from: JSONSerialization.data(withJSONObject: objeto))
    }

    @Test func unaSolaConsulta() throws {
        let mensajes = [
            try mensaje("Paciente activo: Ana", episodio: "e1"),
            try mensaje("hola", episodio: "e1", propio: true, bot: false, autor: "u1"),
        ]
        let episodios = Episodios(mensajes: mensajes, activo: "e1")
        #expect(episodios.orden == ["e1"])
        #expect(episodios.etiqueta(indice: 0, mensajes: mensajes) == "Única consulta")
        #expect(episodios.visibles(mensajes, indice: 0).count == 2)
        #expect(episodios.esActiva(indice: 0, activo: "e1"))
    }

    @Test func variasConsultasYLaActivaVaAlFinal() throws {
        let mensajes = [
            try mensaje("Paciente activo: Ana", episodio: "e1"),
            try mensaje("control", episodio: "e1", propio: true, bot: false, autor: "u1"),
            try mensaje("Paciente activo: Ana", episodio: "e2"),
        ]
        // e3 es una consulta recién abierta, todavía sin mensajes.
        let episodios = Episodios(mensajes: mensajes, activo: "e3")
        #expect(episodios.orden == ["e1", "e2", "e3"])
        #expect(episodios.indice(de: .masNueva) == 2)
        #expect(episodios.indice(de: .consulta("e1")) == 0)
        #expect(episodios.indice(de: .consulta("no-existe")) == 2)
        #expect(episodios.visibles(mensajes, indice: 0).map(\.contenido) == ["Paciente activo: Ana", "control"])
        #expect(episodios.visibles(mensajes, indice: 2).isEmpty)
        #expect(!episodios.esActiva(indice: 0, activo: "e3"))
        #expect(episodios.esActiva(indice: 2, activo: "e3"))
        #expect(episodios.etiqueta(indice: 0, mensajes: mensajes).hasPrefix("Consulta 1/3 · "))
    }

    @Test func elAvisoDeActivacionSeMuestraUnaVez() throws {
        let mensajes = [
            try mensaje("Paciente activo: Ana\n📋 Faltan 24", episodio: "e1"),
            try mensaje("hola", episodio: "e1", propio: true, bot: false, autor: "u1"),
            try mensaje("  Paciente activo: Ana\n📋 Faltan 23", episodio: "e1"),
        ]
        let visibles = Episodios(mensajes: mensajes, activo: "e1").visibles(mensajes, indice: 0)
        #expect(visibles.map(\.contenido) == ["hola", "  Paciente activo: Ana\n📋 Faltan 23"])
    }

    @Test func elAutorSeMuestraUnaVezPorRacha() throws {
        let lista = [
            try mensaje("a", episodio: nil, bot: false, autor: "u2"),
            try mensaje("b", episodio: nil, bot: false, autor: "u2"),
            try mensaje("c", episodio: nil),
            try mensaje("d", episodio: nil, propio: true, bot: false, autor: "u1"),
            try mensaje("e", episodio: nil),
        ]
        let autores = lista.indices.map { Episodios.autor(en: lista, indice: $0) }
        #expect(autores == ["Profesional", nil, "Asistente", nil, "Asistente"])
    }
}
