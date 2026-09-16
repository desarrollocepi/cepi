import Foundation
import Testing
@testable import CEPITelemedicina

/// Formularios de la ficha y búsquedas tal como los devuelve hoy el stack local (PAPER §24.4).
struct FichaContratoTests {
    private func decodificar<T: Decodable>(_ tipo: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(tipo, from: Data(json.utf8))
    }

    @Test func grupoConOpcionesBooleanas() throws {
        let formulario = try decodificar(FormularioBot.self, """
        {"id":"ficha_grp_g_4_1","title":"4.1 Lesión elemental","submit_mode":"structured","submit_label":"Guardar",
         "actions":[{"label":"Omitir","send":"omitir ficha"}],
         "fields":[{"key":"lesion_macula","label":"Lesión: Mácula","type":"radio",
                    "options":[{"label":"Sí","value":true},{"label":"No","value":false}]},
                   {"key":"lesion_otra","label":"Lesión: Otra","type":"text"}]}
        """)
        #expect(formulario.estructurado)
        #expect(formulario.textoEnviar == "Guardar")
        #expect(formulario.acciones.map(\.send) == ["omitir ficha"])
        #expect(formulario.campos[0].tipo == .opciones)
        #expect(formulario.campos[0].opciones.map(\.etiqueta) == ["Sí", "No"])
        #expect(formulario.campos[0].opciones.map(\.valor) == [.booleano(true), .booleano(false)])
        #expect(formulario.campos[1].tipo == .texto)
    }

    @Test func grupoPrellenadoYTiposEspeciales() throws {
        let contacto = try decodificar(FormularioBot.self, """
        {"id":"ficha_grp_g_1_1","title":"1.1 Datos de contacto","submit_mode":"structured",
         "fields":[{"key":"direccion","label":"Dirección","type":"text"},{"key":"telefono","label":"Teléfono","type":"text"}],
         "values":{"direccion":"Av. Castro #647","telefono":"0923453558"}}
        """)
        #expect(contacto.valores["direccion"] == .texto("Av. Castro #647"))

        let imagenes = try decodificar(FormularioBot.self, """
        {"id":"ficha_grp_g_4_7","title":"4.7 Imágenes Lesión","submit_mode":"structured",
         "fields":[{"key":"imagenes_lesion","label":"Imágenes de la lesión","type":"image_upload","multiple":true}]}
        """)
        #expect(imagenes.campos[0].tipo == .imagenes)
        #expect(imagenes.campos[0].multiple)

        let diagnostico = try decodificar(FormularioBot.self, """
        {"id":"ficha_grp_g_5","title":"5 Diagnóstico","submit_mode":"structured",
         "fields":[{"key":"diagnostico","label":"Diagnóstico (CIE-10)","type":"icd_search"},
                   {"key":"diagnostico_letra","label":"Semáforo A/B/C","type":"radio","options":["A","B","C"]}]}
        """)
        #expect(diagnostico.campos.map(\.tipo) == [.busquedaCIE, .opciones])
        #expect(diagnostico.campos[1].opciones.map(\.valor) == [.texto("A"), .texto("B"), .texto("C")])
    }

    @Test func tipoDesconocidoSePintaComoTexto() throws {
        let campo = try decodificar(CampoFormulario.self, #"{"key":"x","label":"X","type":"firma_digital"}"#)
        #expect(campo.tipo == .texto)
    }

    @Test func formularioNuloNoEsFormularioAusente() throws {
        let nulo = try decodificar(RespuestaChat.self, #"{"ok":true,"session_id":"s","form":null,"bookmarks":[]}"#)
        #expect(nulo.traeFormulario)
        #expect(nulo.formulario == nil)
        #expect(nulo.marcadores == [])

        let sinClave = try decodificar(RespuestaChat.self, #"{"ok":true,"session_id":"s"}"#)
        #expect(!sinClave.traeFormulario)
        #expect(sinClave.marcadores == nil)
    }

    @Test func guardadoAvanzaAlSiguienteGrupo() throws {
        let respuesta = try decodificar(RespuestaChat.self, """
        {"ok":true,"session_id":"s","text":"Guardado. Siguiente: 3.3 Curso.","await_isic":[],"pending_action":null,
         "form":{"id":"ficha_grp_g_3_3","title":"3.3 Curso","submit_mode":"structured",
                 "fields":[{"key":"curso","label":"Curso","type":"radio","options":["progresivo","regresivo"]}]},
         "bookmarks":[{"id":"g_1_1","label":"1.1 Datos de contacto","category":"Filiación","done":true,"conDato":true},
                      {"id":"g_3_3","label":"3.3 Curso","category":"Anamnesis","done":false,"conDato":false}]}
        """)
        #expect(respuesta.formulario?.id == "ficha_grp_g_3_3")
        #expect(respuesta.marcadores?.map(\.hecho) == [true, false])
    }

    @Test func gruposMiembrosYCIE10() throws {
        let grupos = try decodificar(Lista<GrupoDerivacion>.self, """
        {"ok":true,"data":[{"id":"g1","slug":"dermatologia","name":"Dermatología","kind":"specialty","member_count":2,
                            "active":true,"data":{},"description":null,"created_at":"x","created_by":null,"updated_at":"y"},
                           {"id":"g2","slug":"todos","name":"Toda la red","kind":"all","member_count":5}]}
        """)
        #expect(grupos.data.map(\.tipo) == ["specialty", "all"])
        #expect(grupos.data[0].miembros == 2)

        let miembros = try decodificar(Lista<MiembroGrupo>.self, """
        {"ok":true,"data":[{"user_id":"u3","role_in_group":"member","created_at":"x","name":"Dr. Derma Uno","email":"derma1@cepi.local"}]}
        """)
        #expect(miembros.data.first?.id == "u3")

        let cie = try decodificar(BusquedaCIE.self, #"{"ok":true,"results":[{"code":"C43","title":"Melanoma maligno de la piel"}]}"#)
        #expect(cie.results.first?.code == "C43")
    }
}
