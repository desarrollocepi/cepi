import Foundation
import Testing
@testable import CEPITelemedicina

struct LogicaFichaTests {
    private func formulario(_ json: String) throws -> FormularioBot {
        try JSONDecoder().decode(FormularioBot.self, from: Data(json.utf8))
    }

    private func registro(_ json: String) throws -> Registro {
        try JSONDecoder().decode(Registro.self, from: Data(json.utf8))
    }

    @Test func unaSolaPreguntaDeOpcionSeEnviaAlElegir() throws {
        let cerrado = try formulario(#"{"id":"f","title":"1.4","submit_mode":"structured","fields":[{"key":"etnia","label":"Etnia","type":"radio","options":["a","b"]}]}"#)
        #expect(LogicaFormulario.seEnviaAlElegir(cerrado))
        #expect(!LogicaFormulario.muestraBotonEnviar(cerrado))

        let agrupado = try formulario(#"{"id":"f","title":"3.4","submit_mode":"structured","fields":[{"key":"a","label":"A","type":"radio","options":["x"]},{"key":"b","label":"B","type":"radio","options":["y"]}]}"#)
        #expect(!LogicaFormulario.seEnviaAlElegir(agrupado))
        #expect(LogicaFormulario.muestraBotonEnviar(agrupado))
    }

    @Test func valoresInicialesYEnvioEstructurado() throws {
        let f = try formulario("""
        {"id":"f","title":"t","submit_mode":"structured",
         "fields":[{"label":"Sección","type":"heading"},{"key":"texto","label":"T","type":"text"},
                   {"key":"casilla","label":"C","type":"checkbox"},{"key":"macula","label":"M","type":"radio","options":[{"label":"No","value":false}]}],
         "values":{"texto":"guardado"}}
        """)
        var valores = LogicaFormulario.valoresIniciales(f)
        #expect(valores == ["texto": .texto("guardado"), "casilla": .booleano(false), "macula": .texto("")])

        valores["texto"] = .texto("")
        valores["macula"] = .booleano(false)
        // Sin textos vacíos; los `false` sí viajan (son una respuesta).
        #expect(LogicaFormulario.datosEstructurados(f, valores: valores) == ["casilla": .booleano(false), "macula": .booleano(false)])
        #expect(LogicaFormulario.puedeEnviar(f, valores: valores))
    }

    @Test func formularioDeMensajeConObligatorios() throws {
        let f = try formulario("""
        {"id":"nuevo_paciente","title":"Nuevo","submit_label":"Crear paciente","submit_send":"/nuevo-paciente {cedula} || {nombre}",
         "fields":[{"key":"cedula","label":"Cédula","required":true},{"key":"nombre","label":"Nombres","required":true}]}
        """)
        #expect(!LogicaFormulario.puedeEnviar(f, valores: ["cedula": .texto("09"), "nombre": .texto("  ")]))
        let completos: [String: JSONValor] = ["cedula": .texto(" 0912345678 "), "nombre": .texto("Ana")]
        #expect(LogicaFormulario.puedeEnviar(f, valores: completos))
        #expect(LogicaFormulario.mensaje(f, valores: completos) == "/nuevo-paciente 0912345678 || Ana")
    }

    @Test func elegirUnPacienteArmaElComando() throws {
        let campo = try JSONDecoder().decode(CampoFormulario.self, from: Data("""
        {"key":"p","label":"Paciente","type":"entity_search","entity_id":"11000000-0000-0000-0000-000000000000",
         "on_select_send":"activar paciente {id}","result_label":["nombre","apellidos"],"result_sub":"cedula"}
        """.utf8))
        let paciente = try registro(#"{"id":"p9","title":"Valentina Castro","data":{"nombre":"Valentina","apellidos":"Castro Reyes","cedula":"0000000009"}}"#)
        #expect(LogicaFormulario.mensajeAlElegir(campo, registro: paciente) == "activar paciente p9")
        #expect(LogicaFormulario.etiquetaResultado(campo, registro: paciente) == "Valentina Castro Reyes")
    }

    @Test func unNumeroGuardadoMarcaSuOpcionDeTexto() throws {
        let opcion = try JSONDecoder().decode(OpcionCampo.self, from: Data(#""2""#.utf8))
        #expect(LogicaFormulario.coincide(.numero(2), con: opcion))
        #expect(!LogicaFormulario.coincide(.numero(3), con: opcion))
    }

    @Test func regionesEnElOrdenDeLaTabla() {
        var csv = ""
        csv = RegionCorporal.alternar("abdomen", en: csv)
        csv = RegionCorporal.alternar("cabeza_ant", en: csv)
        #expect(csv == "cabeza_ant,abdomen")
        csv = RegionCorporal.alternar("abdomen", en: csv)
        #expect(csv == "cabeza_ant")
        #expect(RegionCorporal.todas.count == 38)
        #expect(Set(RegionCorporal.todas.map(\.clave)).count == RegionCorporal.todas.count)
        #expect(RegionCorporal.resumen("cabeza_ant") == "1 región(es): Cabeza (frontal)")
    }

    @Test func seccionesPorCategoriaEnOrden() throws {
        let marcadores = try JSONDecoder().decode([Marcador].self, from: Data("""
        [{"id":"g_1_1","label":"1.1","category":"Filiación","done":true},{"id":"g_1_2","label":"1.2","category":"Filiación","done":false},
         {"id":"g_3_1","label":"3.1","category":"Anamnesis","done":false}]
        """.utf8))
        let grupos = Marcador.porCategoria(marcadores)
        #expect(grupos.map(\.categoria) == ["Filiación", "Anamnesis"])
        #expect(grupos[0].marcadores.count == 2)
    }

    @Test func datosDelVisorComoLaWeb() {
        let paciente: [String: JSONValor] = ["nombre": .texto("Ana"), "apellidos": .texto("Ruiz"), "fecha_nac": .texto("2000-06-15")]
        let episodio: [String: JSONValor] = ["motivo_consulta": .texto("control"), "picor": .texto("leve")]
        let hoy = Fechas.dia("2026-09-16")!
        let datos = DatosFicha.combinar(paciente: paciente, episodio: episodio, hoy: hoy)
        #expect(datos["nombre"] == .texto("Ana Ruiz"))
        #expect(datos["edad"] == .numero(26))
        #expect(datos["motivo_consulta"] == .texto("control"))

        let anterior: [String: JSONValor] = ["picor": .texto("severo"), "dolor": .booleano(false), "fecha": .texto("2026-01-01"), "x:rel": .texto("1")]
        // `dolor: false` vale lo mismo que ausente; `fecha` y las relaciones no se comparan.
        #expect(DatosFicha.cambios(actual: episodio, anterior: anterior) == ["motivo_consulta": .nulo, "picor": .texto("severo")])
        #expect(DatosFicha.cambios(actual: episodio, anterior: nil).isEmpty)

        let barra = String(UnicodeScalar(92))
        #expect(DatosFicha.javascript(["a": .texto("x\u{2028}y")]) == "{\"a\":\"x" + barra + "u2028y\"}")
    }
}
