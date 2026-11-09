package ec.cepi.telemedicina

import ec.cepi.telemedicina.ServidorFalso.Respuesta
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Credenciales
import ec.cepi.telemedicina.api.FichaGroup
import ec.cepi.telemedicina.api.FichaGroupSaveResult
import ec.cepi.telemedicina.api.FilaEvolucion
import ec.cepi.telemedicina.api.FullFicha
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.TipoCampo
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.ficha.FullFichaLogic
import ec.cepi.telemedicina.ficha.LogicaFormulario
import ec.cepi.telemedicina.ficha.ObservationEdit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La pestaña Ficha editable (PAPER §24.2.1) y la Evolución nativa (§28.3): el contrato de
 * `GET /api/bot/ficha` (`fichaCompleta` en cepi-bot/src/flowV1.ts) y las reglas de
 * `FichaCompleta.vue` y `EvolucionPaciente.vue`.
 */
class FichaCompletaTest {
    /** La forma real de `GET /api/bot/ficha`, recortada a siete grupos representativos. */
    private val fichaJson = """
        {"ok":true,"episode_id":"e2","patient_id":"p1",
         "grupos":[
          {"id":"g_1_3","label":"1.3 Sexo","category":"Filiación","target":"patient","done":true,
           "form":{"id":"ficha_grp_g_1_3","title":"1.3 Sexo","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"key":"sexo","label":"Sexo","type":"radio","options":["M","F","Otro"]}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}],
                   "values":{"sexo":"F"}}},
          {"id":"g_2_1","label":"2.1 Antecedentes personales","category":"Antecedentes","target":"patient","done":false,
           "form":{"id":"ficha_grp_g_2_1","title":"2.1 Antecedentes personales","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"key":"antecedentes_personales_presente","label":"¿Antecedentes personales?","type":"radio",
                              "options":[{"label":"Sí","value":true},{"label":"No","value":false}]},
                             {"key":"antecedentes_personales","label":"Detalle antecedentes personales","type":"textarea"}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}]}},
          {"id":"g_3_1","label":"3.1 Motivo de consulta","category":"Anamnesis","target":"episode","done":true,
           "form":{"id":"ficha_grp_g_3_1","title":"3.1 Motivo de consulta","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"key":"motivo_consulta","label":"Motivo de consulta","type":"textarea"},
                             {"key":"anamnesis","label":"Anamnesis (notas)","type":"textarea"}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}],
                   "values":{"motivo_consulta":"Placas descamativas en codos desde hace 6 meses"}}},
          {"id":"g_prioridad","label":"3.8 Prioridad clínica","category":"Anamnesis","target":"episode","done":true,
           "form":{"id":"ficha_grp_g_prioridad","title":"3.8 Prioridad clínica","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"label":"Urgente: erupción con compromiso general… Programada: estable, sin alarma.","type":"heading"},
                             {"key":"prioridad","label":"Prioridad clínica","type":"radio","options":["Urgente","Preferente","Programada"]}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}],
                   "values":{"prioridad":"Preferente"}}},
          {"id":"g_4_7","label":"4.7 Imágenes Lesión","category":"Examen físico","target":"episode","done":true,
           "form":{"id":"ficha_grp_g_4_7","title":"4.7 Imágenes Lesión","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"key":"imagenes_lesion","label":"Imágenes de la lesión","type":"image_upload","multiple":true}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}]}},
          {"id":"g_7","label":"7 Tratamiento y plan","category":"Tratamiento","target":"episode","done":true,
           "form":{"id":"ficha_grp_g_7","title":"7 Tratamiento y plan","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"key":"tratamiento_resumen","label":"Tratamiento","type":"textarea"},
                             {"key":"plan","label":"Plan","type":"textarea"},
                             {"key":"proximo_control_fecha","label":"Próximo control","type":"date"},
                             {"key":"proximo_control_motivo","label":"Motivo del próximo control","type":"text"},
                             {"key":"observaciones","label":"Observaciones","type":"textarea"}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}],
                   "values":{"tratamiento_resumen":"Clobetasol 0,05% crema c/12h","proximo_control_fecha":"2026-12-09","observaciones":""}}},
          {"id":"g_8","label":"8.1 Consentimiento informado (firma el paciente)","category":"Consentimiento","target":"patient","done":false,
           "form":{"id":"ficha_grp_g_8","title":"8.1 Consentimiento informado (firma el paciente)","submit_mode":"structured","submit_label":"Guardar",
                   "fields":[{"key":"imagen_consentimiento","label":"Foto del consentimiento informado firmado por el paciente","type":"image_upload"}],
                   "actions":[{"label":"Omitir","send":"omitir ficha"}]}}
         ],
         "faltantes":["2.1 Antecedentes personales","8.1 Consentimiento informado (firma el paciente)"],
         "completos":5,"total":7}
    """

    private val ficha: FullFicha get() = jsonCepi.decodeFromString(fichaJson)
    private fun group(id: String): FichaGroup = ficha.groups.single { it.id == id }

    // Contrato

    @Test
    fun decodificaLaFichaCompleta() {
        val f = ficha
        assertEquals("e2", f.episodeId)
        assertEquals("p1", f.patientId)
        assertEquals(7, f.groups.size)
        assertEquals(5, f.done)
        assertEquals(7, f.total)
        assertEquals(listOf("2.1 Antecedentes personales", "8.1 Consentimiento informado (firma el paciente)"), f.missing)
        val sexo = group("g_1_3")
        assertEquals("Filiación", sexo.category)
        assertEquals("patient", sexo.target)
        assertTrue(sexo.form!!.estructurado)
        assertEquals(JsonPrimitive("F"), sexo.form!!.valores["sexo"])
        val prioridad = group("g_prioridad").form!!
        assertEquals(TipoCampo.Titulo, prioridad.campos[0].tipo)
        assertNull(prioridad.campos[0].clave)
    }

    @Test
    fun sinTotalCuentaLosGrupos() {
        val f = jsonCepi.decodeFromString<FullFicha>("""{"ok":true,"grupos":[{"id":"g_5","label":"5 Diagnóstico","category":"Diagnóstico","done":false,"target":"episode","form":null}],"completos":0}""")
        assertEquals(1, f.total)
        assertNull(f.groups.single().form)
    }

    @Test
    fun cuerpoDeGuardarGrupo() {
        val cuerpo = CepiApi.fichaGroupBody("g_1_3", buildJsonObject { put("sexo", "M") }, "e2", "p1")
        assertEquals("""{"group_id":"g_1_3","data":{"sexo":"M"},"episode_id":"e2","patient_id":"p1"}""", cuerpo.toString())
        // Sin episodio (paciente sin consultas): solo el paciente.
        assertEquals(
            """{"group_id":"g_1_3","data":{},"patient_id":"p1"}""",
            CepiApi.fichaGroupBody("g_1_3", buildJsonObject {}, null, "p1").toString(),
        )
    }

    @Test
    fun resultadoDeGuardar() {
        val r = jsonCepi.decodeFromString<FichaGroupSaveResult>("""{"ok":true,"target":"episode","targetId":"e2","completitud":74}""")
        assertTrue(r.ok)
        assertEquals(74.0, r.completeness!!, 0.0)
        assertEquals("Guardado · 74% de la ficha", FullFichaLogic.savedNotice(r.completeness))
        assertEquals("Guardado", FullFichaLogic.savedNotice(null))
    }

    @Test
    fun pideYGuardaContraElBot() = runBlocking {
        val s = ServidorFalso().apply {
            fijar("GET /api/bot/ficha", Respuesta.Http(200, fichaJson))
            fijar("POST /api/bot/ficha/grupo", Respuesta.Http(200, """{"ok":true,"target":"patient","targetId":"p1","completitud":81}"""))
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        assertEquals(7, api.fullFicha("e2", "p1").groups.size)
        val r = api.saveFichaGroup("g_1_3", buildJsonObject { put("sexo", "M") }, "e2", "p1")
        assertEquals(81.0, r.completeness!!, 0.0)
        assertEquals(
            """{"group_id":"g_1_3","data":{"sexo":"M"},"episode_id":"e2","patient_id":"p1"}""",
            s.cuerpo("POST /api/bot/ficha/grupo"),
        )
    }

    @Test
    fun unPayloadInvalidoLlegaComoError() = runBlocking {
        val s = ServidorFalso().apply {
            fijar("POST /api/bot/ficha/grupo", Respuesta.Http(400, """{"ok":false,"error":"El grupo g_4_7 se completa subiendo fotos"}"""))
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        val error = runCatching { api.saveFichaGroup("g_4_7", buildJsonObject {}, "e2", "p1") }.exceptionOrNull()
        assertTrue(error is ApiError)
    }

    // Progreso y «Solo lo que falta»

    @Test
    fun progreso() {
        assertEquals("5 de 7 grupos con dato", FullFichaLogic.progressText(ficha))
        assertEquals(71, FullFichaLogic.percent(ficha))
        assertEquals(0, FullFichaLogic.percent(FullFicha()))
    }

    @Test
    fun categoriasEnOrdenConSuCuenta() {
        val categorias = FullFichaLogic.categories(ficha.groups, onlyMissing = false)
        assertEquals(
            listOf("Filiación", "Antecedentes", "Anamnesis", "Examen físico", "Tratamiento", "Consentimiento"),
            categorias.map { it.name },
        )
        val anamnesis = categorias.single { it.name == "Anamnesis" }
        assertEquals(listOf("g_3_1", "g_prioridad"), anamnesis.visible.map { it.id })
        assertEquals(2, anamnesis.done)
    }

    @Test
    fun soloLoQueFalta() {
        val categorias = FullFichaLogic.categories(ficha.groups, onlyMissing = true)
        // Las categorías completas desaparecen; las otras muestran solo lo vacío.
        assertEquals(listOf("Antecedentes", "Consentimiento"), categorias.map { it.name })
        assertEquals(listOf("g_2_1"), categorias[0].visible.map { it.id })
        // La cuenta sigue siendo sobre todos los grupos de la categoría.
        assertEquals(1, categorias[0].groups.size)
        assertEquals(0, categorias[0].done)
    }

    @Test
    fun sinCategoriaVaAOtros() {
        val categorias = FullFichaLogic.categories(listOf(FichaGroup("g_x", "X", "", done = false)), onlyMissing = false)
        assertEquals("Otros", categorias.single().name)
    }

    // Qué se edita

    @Test
    fun gruposDeImagenNoSeEditan() {
        for (id in listOf("g_4_7", "g_8")) {
            assertEquals("Las fotos se suben en Imágenes o en el chat", FullFichaLogic.editDisabledReason(group(id), "e2"))
        }
        assertEquals(
            "Las fotos se suben en Imágenes o en el chat",
            FullFichaLogic.editDisabledReason(FichaGroup("g_8_2", "8.2", "Consentimiento", target = "patient"), "e2"),
        )
        assertNull(FullFichaLogic.editDisabledReason(group("g_1_3"), "e2"))
        assertNull(FullFichaLogic.editDisabledReason(group("g_7"), "e2"))
    }

    @Test
    fun sinConsultaSoloSeEditaLoDelPaciente() {
        assertNull(FullFichaLogic.editDisabledReason(group("g_1_3"), null))
        assertEquals("Primero abre una consulta", FullFichaLogic.editDisabledReason(group("g_3_1"), null))
        assertEquals("Este grupo no tiene formulario", FullFichaLogic.editDisabledReason(FichaGroup("g_5", "5", "Diagnóstico"), "e2"))
    }

    @Test
    fun textoDelBoton() {
        assertEquals("Editar", FullFichaLogic.buttonText(group("g_1_3")))
        assertEquals("Completar", FullFichaLogic.buttonText(group("g_2_1")))
    }

    @Test
    fun elFormularioEditableNoLlevaOmitir() {
        val original = group("g_7").form!!
        assertEquals(1, original.acciones.size)
        val editable = FullFichaLogic.editableForm(group("g_7"))!!
        assertTrue(editable.acciones.isEmpty())
        assertEquals(original.campos, editable.campos)
        assertEquals(original.valores, editable.valores)
        // El mismo renderer del chat: abre prellenado y guarda estructurado.
        val iniciales = LogicaFormulario.valoresIniciales(editable)
        assertEquals(JsonPrimitive("Clobetasol 0,05% crema c/12h"), iniciales["tratamiento_resumen"])
        assertTrue(LogicaFormulario.muestraBotonEnviar(editable))
    }

    @Test
    fun laGuiaDePrioridadSeMuestraEnElFormularioYNoComoDato() {
        val form = FullFichaLogic.editableForm(group("g_prioridad"))!!
        assertEquals(TipoCampo.Titulo, form.campos.first().tipo)
        assertEquals(listOf("prioridad"), LogicaFormulario.camposDeDatos(form).map { it.clave })
        assertEquals(listOf("Prioridad clínica" to "Preferente"), FullFichaLogic.values(group("g_prioridad"), null).map { it.label to it.text })
    }

    // Lo cargado de cada grupo

    @Test
    fun valoresLegibles() {
        val g7 = FullFichaLogic.values(group("g_7"), null)
        // El vacío no sale; el resto en el orden del formulario.
        assertEquals(listOf("Tratamiento", "Próximo control"), g7.map { it.label })
        assertTrue(FullFichaLogic.values(group("g_2_1"), null).isEmpty())
        val siNo = group("g_2_1").form!!.campos[0]
        assertEquals("Sí", FullFichaLogic.text(JsonPrimitive(true), siNo))
        assertEquals("No", FullFichaLogic.text(JsonPrimitive(false), null))
        assertEquals(
            "torax, Brazo izq.",
            FullFichaLogic.text(jsonCepi.parseToJsonElement("""["torax",{"label":"Brazo izq.","value":"brazo_i"}]"""), null),
        )
        assertEquals("2", FullFichaLogic.text(JsonPrimitive(2.0), null))
    }

    @Test
    fun cambiosRespectoDeLaConsultaAnterior() {
        val anterior = mapOf(
            "motivo_consulta" to JsonPrimitive("Placas en codos"),
            "tratamiento_resumen" to JsonPrimitive("Clobetasol 0,05% crema c/12h"),
            "fecha" to JsonPrimitive("2026-08-01"),
        )
        val motivo = FullFichaLogic.values(group("g_3_1"), anterior).single()
        assertEquals(JsonPrimitive("Placas en codos"), motivo.previous!!.before)
        // Igual que antes: no se marca.
        assertNull(FullFichaLogic.values(group("g_7"), anterior).first().previous)
        // Lo nuevo (antes vacío) sí.
        assertEquals("(vacío)", FullFichaLogic.previousText(FullFichaLogic.values(group("g_7"), anterior)[1].previous!!.before))
        // Los del paciente no se comparan: los comparten todas las consultas.
        assertNull(FullFichaLogic.values(group("g_1_3"), mapOf("sexo" to JsonPrimitive("M"))).single().previous)
        // motivo, próximo control y prioridad cambiaron.
        assertEquals(3, FullFichaLogic.changeCount(ficha.groups, anterior))
        assertEquals(0, FullFichaLogic.changeCount(ficha.groups, null))
    }

    @Test
    fun barraDeConsultas() {
        val e = { id: String, fecha: String -> Registro(id, data = mapOf("fecha" to JsonPrimitive(fecha))) }
        val tres = listOf(e("e3", "2026-11-01"), e("e2", "2026-09-10T10:00:00Z"), e("e1", "2026-05-02"))
        assertEquals("Episodio 3 de 3", FullFichaLogic.navTitle(tres, 0))
        assertEquals("Episodio 1 de 3", FullFichaLogic.navTitle(tres, 2))
        assertEquals("2 campos cambiaron desde el del 2026-09-10", FullFichaLogic.navDetail(tres, 0, false, 2))
        assertEquals("1 campo cambió desde el del 2026-05-02", FullFichaLogic.navDetail(tres, 1, false, 1))
        assertEquals("sin cambios respecto del 2026-09-10", FullFichaLogic.navDetail(tres, 0, false, 0))
        assertEquals("es el primer episodio del paciente", FullFichaLogic.navDetail(tres, 2, false, 0))
        assertEquals("único episodio registrado de este paciente", FullFichaLogic.navDetail(tres.take(1), 0, false, 0))
        assertEquals("buscando los otros episodios…", FullFichaLogic.navDetail(emptyList(), 0, true, 0))
        assertEquals("sin consultas registradas", FullFichaLogic.navDetail(emptyList(), 0, false, 0))
        assertEquals("Episodio", FullFichaLogic.navTitle(emptyList(), 0))
    }

    @Test
    fun respuestaDelEspecialista() {
        assertNull(FullFichaLogic.specialistAnswer(null))
        assertNull(FullFichaLogic.specialistAnswer(mapOf("recomendacion" to JsonPrimitive("  "))))
        val r = FullFichaLogic.specialistAnswer(
            mapOf("recomendacion" to JsonPrimitive("Biopsia en sacabocado"), "recomendacion_at" to JsonPrimitive("2026-11-02T14:00:00Z")),
        )
        assertEquals("Biopsia en sacabocado" to "2026-11-02T14:00:00Z", r)
    }

    // Evolución: observaciones en línea

    private val filas = listOf(
        FilaEvolucion("e2", fecha = "2026-11-01", medico = "Dra. Ruiz", observaciones = "Mejoría parcial"),
        FilaEvolucion("e1", fecha = "2026-05-02", medico = "Dr. Pérez"),
    )

    @Test
    fun editarObservacionesUnaALaVez() {
        assertNull(ObservationEdit.editDisabledReason(null, filas[0]))
        val edit = ObservationEdit.start(filas[0])
        assertEquals("Mejoría parcial", edit.draft)
        assertEquals("Termina primero la otra observación", ObservationEdit.editDisabledReason(edit, filas[1]))
        assertEquals("Ya la estás editando", ObservationEdit.editDisabledReason(edit, filas[0]))
    }

    @Test
    fun guardarDeshabilitadoSinCambios() {
        val edit = ObservationEdit.start(filas[0])
        assertTrue(edit.unchanged)
        assertEquals("No hay cambios que guardar", edit.saveDisabledReason)
        // Solo espacios alrededor tampoco es un cambio.
        assertEquals("No hay cambios que guardar", edit.copy(draft = " Mejoría parcial  ").saveDisabledReason)
        val cambiada = edit.copy(draft = "Mejoría total ")
        assertNull(cambiada.saveDisabledReason)
        assertEquals("Mejoría total", cambiada.textToSave)
        assertEquals("Guardando…", cambiada.copy(saving = true).saveDisabledReason)
        // Sin observaciones previas: escribir algo habilita Guardar.
        val vacia = ObservationEdit.start(filas[1])
        assertEquals("", vacia.draft)
        assertFalse(vacia.copy(draft = "Control en 3 meses").unchanged)
    }

    @Test
    fun loGuardadoSeVeSinRecargar() {
        val nuevas = ObservationEdit.applySaved(filas, "e1", "Control en 3 meses")
        assertEquals("Control en 3 meses", nuevas[1].observaciones)
        assertEquals("Mejoría parcial", nuevas[0].observaciones)
        // Vaciar borra.
        assertNull(ObservationEdit.applySaved(filas, "e2", "")[0].observaciones)
    }

    @Test
    fun guardarObservacionesVaPorElGrupoG7() = runBlocking {
        val s = ServidorFalso().apply {
            fijar("POST /api/bot/ficha/grupo", Respuesta.Http(200, """{"ok":true,"target":"episode","targetId":"e1","completitud":60}"""))
        }
        val api = s.api(Credenciales(AlmacenMemoria("t")))
        val edit = ObservationEdit.start(filas[1]).copy(draft = " Control en 3 meses ")
        api.saveObservations("p1", edit.episodeId, edit.textToSave)
        assertNotNull(s.cuerpo("POST /api/bot/ficha/grupo"))
        assertEquals(
            """{"group_id":"g_7","data":{"observaciones":"Control en 3 meses"},"episode_id":"e1","patient_id":"p1"}""",
            s.cuerpo("POST /api/bot/ficha/grupo"),
        )
    }
}
