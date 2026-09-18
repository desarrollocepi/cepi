import Foundation
import Testing
@testable import CEPITelemedicina

/// El JSON de `GET /api/bot/galeria` (PAPER §24.2.1 y §24.4), tal como lo devuelve cepi-bot.
struct GaleriaContratoTests {
    private func decodificar<T: Decodable>(_ tipo: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(tipo, from: Data(json.utf8))
    }

    @Test func paginaDeLaGaleria() throws {
        let respuesta = try decodificar(RespuestaGaleria.self, """
        {"ok":true,"total":138,"data":[
          {"id":"i1","attachment_id":"a1","patient_id":"p1","paciente":"Ana Ruiz","cedula":"1712345678",
           "episode_id":"e1","fecha":"2026-07-05","diagnostico":"Dermatitis atópica",
           "codigo_cie10":"L20.9","body_region":"torax","privada":false}]}
        """)
        #expect(respuesta.total == 138)
        let imagen = try #require(respuesta.data.first)
        #expect(imagen.id == "i1")
        #expect(imagen.adjunto == "a1")
        #expect(imagen.pacienteId == "p1")
        #expect(imagen.paciente == "Ana Ruiz")
        #expect(imagen.cedula == "1712345678")
        #expect(imagen.episodioId == "e1")
        #expect(imagen.fecha == "2026-07-05")
        #expect(imagen.diagnostico == "Dermatitis atópica")
        #expect(imagen.codigoCIE10 == "L20.9")
        #expect(imagen.region == "torax")
    }

    /// Una imagen puede no tener episodio, diagnóstico ni región: se sube antes de llenar nada.
    @Test func imagenSinDatosDelCaso() throws {
        let respuesta = try decodificar(RespuestaGaleria.self, """
        {"ok":true,"data":[{"id":"i2","attachment_id":"a2","patient_id":"p2","paciente":"Bruno Paz"}]}
        """)
        let imagen = try #require(respuesta.data.first)
        #expect(imagen.episodioId == nil)
        #expect(imagen.diagnostico == nil)
        #expect(imagen.region == nil)
        #expect(respuesta.total == nil)
    }

    @Test func galeriaVacia() throws {
        let respuesta = try decodificar(RespuestaGaleria.self, #"{"ok":true,"data":[],"total":0}"#)
        #expect(respuesta.data.isEmpty)
        #expect(respuesta.total == 0)
    }
}
