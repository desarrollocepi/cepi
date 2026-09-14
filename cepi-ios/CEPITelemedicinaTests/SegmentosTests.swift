import Testing
@testable import CEPITelemedicina

struct SegmentosTests {
    @Test func textoSinMarcadores() {
        #expect(Segmento.dividir("hola\nmundo") == [.texto("hola\nmundo")])
    }

    @Test func adjuntoDelComposer() {
        let id = "1F61150B-40C5-4C08-9EA8-2588A271268D"
        #expect(Segmento.dividir("Foto de la lesión\n[adjunto: lesion-prueba.jpg · \(id)]") == [
            .texto("Foto de la lesión"),
            .imagen(id: id.lowercased(), nombre: "lesion-prueba.jpg"),
        ])
    }

    @Test func imagenesDelBotEntreTexto() {
        let primera = "11111111-1111-1111-1111-111111111111"
        let segunda = "22222222-2222-2222-2222-222222222222"
        #expect(Segmento.dividir("Resultados:\n[img:\(primera)]\nMelanoma 12%\n[img:\(segunda)]\n") == [
            .texto("Resultados:"),
            .imagen(id: primera, nombre: nil),
            .texto("Melanoma 12%"),
            .imagen(id: segunda, nombre: nil),
        ])
    }
}
