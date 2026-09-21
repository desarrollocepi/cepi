package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.BusquedaCIE
import ec.cepi.telemedicina.api.CampoFormulario
import ec.cepi.telemedicina.api.FormularioBot
import ec.cepi.telemedicina.api.GrupoDerivacion
import ec.cepi.telemedicina.api.Lista
import ec.cepi.telemedicina.api.Marcador
import ec.cepi.telemedicina.api.MiembroGrupo
import ec.cepi.telemedicina.api.OpcionCampo
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.RespuestaChat
import ec.cepi.telemedicina.api.TipoCampo
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.ficha.LogicaFormulario
import ec.cepi.telemedicina.ficha.RegionCorporal
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los de `LogicaFichaTests.swift` y `FichaContratoTests.swift`: la ficha que manda el bot. */
class FormularioTest {
    private fun formulario(json: String) = jsonCepi.decodeFromString<FormularioBot>(json)
    private fun chat(json: String) = RespuestaChat.desde(jsonCepi.decodeFromString<JsonObject>(json))
    private fun texto(valor: String) = JsonPrimitive(valor)

    @Test
    fun unaSolaPreguntaDeOpcionSeEnviaAlElegir() {
        val cerrado = formulario("""{"id":"f","title":"1.4","submit_mode":"structured","fields":[{"key":"etnia","label":"Etnia","type":"radio","options":["a","b"]}]}""")
        assertTrue(LogicaFormulario.seEnviaAlElegir(cerrado))
        assertFalse(LogicaFormulario.muestraBotonEnviar(cerrado))

        val agrupado = formulario(
            """{"id":"f","title":"3.4","submit_mode":"structured","fields":[{"key":"a","label":"A","type":"radio","options":["x"]},{"key":"b","label":"B","type":"radio","options":["y"]}]}""",
        )
        assertFalse(LogicaFormulario.seEnviaAlElegir(agrupado))
        assertTrue(LogicaFormulario.muestraBotonEnviar(agrupado))
    }

    @Test
    fun valoresInicialesYEnvioEstructurado() {
        val f = formulario(
            """
            {"id":"f","title":"t","submit_mode":"structured",
             "fields":[{"label":"Sección","type":"heading"},{"key":"texto","label":"T","type":"text"},
                       {"key":"casilla","label":"C","type":"checkbox"},{"key":"macula","label":"M","type":"radio","options":[{"label":"No","value":false}]}],
             "values":{"texto":"guardado"}}
            """,
        )
        val valores = LogicaFormulario.valoresIniciales(f).toMutableMap()
        assertEquals(mapOf("texto" to texto("guardado"), "casilla" to JsonPrimitive(false), "macula" to texto("")), valores)

        valores["texto"] = texto("")
        valores["macula"] = JsonPrimitive(false)
        // Sin textos vacíos; los `false` sí viajan (son una respuesta).
        assertEquals(
            mapOf<String, JsonElement>("casilla" to JsonPrimitive(false), "macula" to JsonPrimitive(false)),
            LogicaFormulario.datosEstructurados(f, valores),
        )
        assertTrue(LogicaFormulario.puedeEnviar(f, valores))
    }

    @Test
    fun formularioDeMensajeConObligatorios() {
        val f = formulario(
            """
            {"id":"nuevo_paciente","title":"Nuevo","submit_label":"Crear paciente","submit_send":"/nuevo-paciente {cedula} || {nombre}",
             "fields":[{"key":"cedula","label":"Cédula","required":true},{"key":"nombre","label":"Nombres","required":true}]}
            """,
        )
        assertFalse(LogicaFormulario.puedeEnviar(f, mapOf("cedula" to texto("09"), "nombre" to texto("  "))))
        val completos = mapOf("cedula" to texto(" 0912345678 "), "nombre" to texto("Ana"))
        assertTrue(LogicaFormulario.puedeEnviar(f, completos))
        assertEquals("/nuevo-paciente 0912345678 || Ana", LogicaFormulario.mensaje(f, completos))
    }

    @Test
    fun elegirUnPacienteArmaElComando() {
        val campo = jsonCepi.decodeFromString<CampoFormulario>(
            """
            {"key":"p","label":"Paciente","type":"entity_search","entity_id":"11000000-0000-0000-0000-000000000000",
             "on_select_send":"activar paciente {id}","result_label":["nombre","apellidos"],"result_sub":"cedula"}
            """,
        )
        val paciente = jsonCepi.decodeFromString<Registro>(
            """{"id":"p9","title":"Valentina Castro","data":{"nombre":"Valentina","apellidos":"Castro Reyes","cedula":"0000000009"}}""",
        )
        assertEquals("activar paciente p9", LogicaFormulario.mensajeAlElegir(campo, paciente))
        assertEquals("Valentina Castro Reyes", LogicaFormulario.etiquetaResultado(campo, paciente))
        assertEquals(3, campo.minimoCaracteres)
    }

    @Test
    fun unNumeroGuardadoMarcaSuOpcionDeTexto() {
        val opcion = jsonCepi.decodeFromString<OpcionCampo>("\"2\"")
        assertTrue(LogicaFormulario.coincide(JsonPrimitive(2), opcion))
        assertFalse(LogicaFormulario.coincide(JsonPrimitive(3), opcion))
        assertFalse(LogicaFormulario.coincide(JsonPrimitive(true), jsonCepi.decodeFromString<OpcionCampo>("\"true\"")))
    }

    @Test
    fun regionesEnElOrdenDeLaTabla() {
        var csv = ""
        csv = RegionCorporal.alternar("abdomen", csv)
        csv = RegionCorporal.alternar("cabeza_ant", csv)
        assertEquals("cabeza_ant,abdomen", csv)
        csv = RegionCorporal.alternar("abdomen", csv)
        assertEquals("cabeza_ant", csv)
        assertEquals(38, RegionCorporal.todas.size)
        assertEquals(RegionCorporal.todas.size, RegionCorporal.todas.map { it.clave }.toSet().size)
        assertEquals("1 región(es): Cabeza (frontal)", RegionCorporal.resumen("cabeza_ant"))
    }

    @Test
    fun seccionesPorCategoriaEnOrden() {
        val marcadores = jsonCepi.decodeFromString<List<Marcador>>(
            """
            [{"id":"g_1_1","label":"1.1","category":"Filiación","done":true},{"id":"g_1_2","label":"1.2","category":"Filiación","done":false},
             {"id":"g_3_1","label":"3.1","category":"Anamnesis","done":false}]
            """,
        )
        val grupos = Marcador.porCategoria(marcadores)
        assertEquals(listOf("Filiación", "Anamnesis"), grupos.map { it.first })
        assertEquals(2, grupos[0].second.size)
    }

    @Test
    fun grupoConOpcionesBooleanas() {
        val f = formulario(
            """
            {"id":"ficha_grp_g_4_1","title":"4.1 Lesión elemental","submit_mode":"structured","submit_label":"Guardar",
             "actions":[{"label":"Omitir","send":"omitir ficha"}],
             "fields":[{"key":"lesion_macula","label":"Lesión: Mácula","type":"radio",
                        "options":[{"label":"Sí","value":true},{"label":"No","value":false}]},
                       {"key":"lesion_otra","label":"Lesión: Otra","type":"text"}]}
            """,
        )
        assertTrue(f.estructurado)
        assertEquals("Guardar", f.textoEnviar)
        assertEquals(listOf("omitir ficha"), f.acciones.map { it.send })
        assertEquals(TipoCampo.Opciones, f.campos[0].tipo)
        assertEquals(listOf("Sí", "No"), f.campos[0].opciones.map { it.etiqueta })
        assertEquals(listOf(JsonPrimitive(true), JsonPrimitive(false)), f.campos[0].opciones.map { it.valor })
        assertEquals(TipoCampo.Texto, f.campos[1].tipo)
    }

    @Test
    fun grupoPrellenadoYTiposEspeciales() {
        val contacto = formulario(
            """
            {"id":"ficha_grp_g_1_1","title":"1.1 Datos de contacto","submit_mode":"structured",
             "fields":[{"key":"direccion","label":"Dirección","type":"text"},{"key":"telefono","label":"Teléfono","type":"text"}],
             "values":{"direccion":"Av. Castro #647","telefono":"0923453558"}}
            """,
        )
        assertEquals(texto("Av. Castro #647"), contacto.valores["direccion"])

        val imagenes = formulario(
            """
            {"id":"ficha_grp_g_4_7","title":"4.7 Imágenes Lesión","submit_mode":"structured",
             "fields":[{"key":"imagenes_lesion","label":"Imágenes de la lesión","type":"image_upload","multiple":true}]}
            """,
        )
        assertEquals(TipoCampo.Imagenes, imagenes.campos[0].tipo)
        assertTrue(imagenes.campos[0].multiple)

        val diagnostico = formulario(
            """
            {"id":"ficha_grp_g_5","title":"5 Diagnóstico","submit_mode":"structured",
             "fields":[{"key":"diagnostico","label":"Diagnóstico (CIE-10)","type":"icd_search"},
                       {"key":"diagnostico_letra","label":"Semáforo A/B/C","type":"radio","options":["A","B","C"]}]}
            """,
        )
        assertEquals(listOf(TipoCampo.BusquedaCIE, TipoCampo.Opciones), diagnostico.campos.map { it.tipo })
        assertEquals(listOf(texto("A"), texto("B"), texto("C")), diagnostico.campos[1].opciones.map { it.valor })
    }

    @Test
    fun tipoDesconocidoSePintaComoTexto() {
        val campo = jsonCepi.decodeFromString<CampoFormulario>("""{"key":"x","label":"X","type":"firma_digital"}""")
        assertEquals(TipoCampo.Texto, campo.tipo)
    }

    @Test
    fun formularioNuloNoEsFormularioAusente() {
        val nulo = chat("""{"ok":true,"session_id":"s","form":null,"bookmarks":[]}""")
        assertTrue(nulo.traeFormulario)
        assertNull(nulo.formulario)
        assertEquals(emptyList<Marcador>(), nulo.marcadores)

        val sinClave = chat("""{"ok":true,"session_id":"s"}""")
        assertFalse(sinClave.traeFormulario)
        assertNull(sinClave.marcadores)
    }

    @Test
    fun guardadoAvanzaAlSiguienteGrupo() {
        val respuesta = chat(
            """
            {"ok":true,"session_id":"s","text":"Guardado. Siguiente: 3.3 Curso.","await_isic":[],"pending_action":null,
             "form":{"id":"ficha_grp_g_3_3","title":"3.3 Curso","submit_mode":"structured",
                     "fields":[{"key":"curso","label":"Curso","type":"radio","options":["progresivo","regresivo"]}]},
             "bookmarks":[{"id":"g_1_1","label":"1.1 Datos de contacto","category":"Filiación","done":true,"conDato":true},
                          {"id":"g_3_3","label":"3.3 Curso","category":"Anamnesis","done":false,"conDato":false}]}
            """,
        )
        assertEquals("ficha_grp_g_3_3", respuesta.formulario?.id)
        assertEquals(listOf(true, false), respuesta.marcadores?.map { it.hecho })
    }

    @Test
    fun gruposMiembrosYCIE10() {
        val grupos = jsonCepi.decodeFromString<Lista<GrupoDerivacion>>(
            """
            {"ok":true,"data":[{"id":"g1","slug":"dermatologia","name":"Dermatología","kind":"specialty","member_count":2,
                                "active":true,"data":{},"description":null,"created_at":"x","created_by":null,"updated_at":"y"},
                               {"id":"g2","slug":"todos","name":"Toda la red","kind":"all","member_count":5}]}
            """,
        )
        assertEquals(listOf("specialty", "all"), grupos.data.map { it.tipo })
        assertEquals(2, grupos.data[0].miembros)

        val miembros = jsonCepi.decodeFromString<Lista<MiembroGrupo>>(
            """{"ok":true,"data":[{"user_id":"u3","role_in_group":"member","created_at":"x","name":"Dr. Derma Uno","email":"derma1@cepi.local"}]}""",
        )
        assertEquals("u3", miembros.data.first().usuario)

        val cie = jsonCepi.decodeFromString<BusquedaCIE>("""{"ok":true,"results":[{"code":"C43","title":"Melanoma maligno de la piel"}]}""")
        assertEquals("C43", cie.results.first().code)
    }
}
