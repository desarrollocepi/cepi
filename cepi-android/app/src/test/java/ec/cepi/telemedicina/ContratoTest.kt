package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.ApiClient
import ec.cepi.telemedicina.api.Asignaciones
import ec.cepi.telemedicina.api.CaseReview
import ec.cepi.telemedicina.api.ClaimResult
import ec.cepi.telemedicina.api.Derivaciones
import ec.cepi.telemedicina.api.Derivado
import ec.cepi.telemedicina.api.Responsable
import ec.cepi.telemedicina.api.Revisado
import ec.cepi.telemedicina.api.ReviewCompletion
import ec.cepi.telemedicina.api.Uno
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.ClinicalPriority
import ec.cepi.telemedicina.api.ColaRevision
import ec.cepi.telemedicina.api.Confirmacion
import ec.cepi.telemedicina.api.FilaEvolucion
import ec.cepi.telemedicina.api.Lista
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.SesionRespuesta
import ec.cepi.telemedicina.api.jsonCepi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Las formas JSON que devuelve el backend hoy (PAPER §24.4): los mismos cuerpos que
 * `ContratoTests.swift`. Si el backend cambia una clave, fallan las dos suites y no la mano de
 * un médico.
 */
class ContratoTest {
    private inline fun <reified T> decodificar(json: String): T = jsonCepi.decodeFromString(json)

    @Test
    fun sesionDeMe() {
        val respuesta = decodificar<SesionRespuesta>(
            """
            {"ok":true,"token":"abc","user":{"id":"u1","name":"Dra. Pérez","email":"p@cepi.ec",
             "role":"medico_primario","phone":"","cedula":"","permissions":["entity:x:record:create"],
             "org_id":"o2","orgs":[{"id":"o1","slug":"cepi","name":"CEPI","role_in_org":"member"},
             {"id":"o2","slug":"cepi-testing","name":"CEPI Testing","role_in_org":"member"}],
             "terms_version":"2026-11-15","terms_accepted_at":"2026-11-15T16:40:00.000Z"}}
            """,
        )
        assertEquals("abc", respuesta.token)
        assertEquals("2026-11-15", respuesta.user.termsVersion)
        assertEquals("o2", respuesta.user.orgActiva)
        assertEquals(listOf("CEPI", "CEPI Testing"), respuesta.user.orgs.map { it.name })
        assertEquals(listOf("entity:x:record:create"), respuesta.user.permissions)
    }

    @Test
    fun loginSinOrganizaciones() {
        val respuesta = decodificar<SesionRespuesta>(
            """{"ok":true,"token":"t","user":{"id":"u","name":"X","email":"x@cepi.ec","role":"pendiente","permissions":[]}}""",
        )
        assertTrue(respuesta.user.orgs.isEmpty())
        assertNull(respuesta.user.orgActiva)
        assertEquals("pendiente", respuesta.user.role)
    }

    /** `/me` de una cuenta pendiente en telemedicina y aprobada en otras (backend 2026-11-11):
     *  la pantalla de «pendiente» ofrece entrar solo a las reales donde tiene rol. */
    @Test
    fun pendienteConRolEnOtraOrg() {
        val respuesta = decodificar<SesionRespuesta>(
            """{"ok":true,"token":"abc","user":{"id":"u1","name":"Dr. X","email":"x@cepi.ec","role":"pendiente",
             "permissions":["chat:bot"],"org_id":"tele","orgs":[
             {"id":"tele","slug":"cepi","name":"CEPI Telemedicina","role_in_org":"member","features":[],"sandbox":false,"approved":false},
             {"id":"cons","slug":"cepi-drpro","name":"Consultorio","role_in_org":"member","features":[],"sandbox":false,"approved":true},
             {"id":"test","slug":"cepi-testing","name":"Testing","role_in_org":"member","features":[],"sandbox":true,"approved":true}]}}""",
        )
        assertEquals(listOf("cons"), respuesta.user.otrasOrgsAprobadas.map { it.id })
        // Un backend viejo no manda `approved`: no se ofrece nada.
        val viejo = decodificar<SesionRespuesta>(
            """{"ok":true,"token":"t","user":{"id":"u","name":"X","email":"x@cepi.ec","role":"pendiente","permissions":[],
             "org_id":"o1","orgs":[{"id":"o1","slug":"cepi","name":"CEPI"},{"id":"o2","slug":"cepi-drpro","name":"C"}]}}""",
        )
        assertTrue(viejo.user.otrasOrgsAprobadas.isEmpty())
    }

    /** `DELETE /api/auth/me {"confirm":true}`. Los rechazos los prueba `SesionTest`. */
    @Test
    fun borradoDeCuenta() {
        assertTrue(decodificar<Confirmacion>("""{"ok":true}""").ok)
    }

    @Test
    fun registroConCamposDinamicos() {
        val lista = decodificar<Lista<Registro>>(
            """
            {"ok":true,"data":[{"id":"p1","title":"Ana Ruiz","entity_id":"11000000-0000-0000-0000-000000000000",
              "data":{"nombre":"Ana","apellidos":" Ruiz ","cedula":1712345678,"alergias":null,
                      "fumador":true,"peso":61.5,"regiones":["torax"],"vacio":""}}]}
            """,
        )
        val paciente = lista.data.single()
        assertEquals(CepiApi.DEFINICION_PACIENTE, paciente.definicion)
        assertEquals("Ana", paciente["nombre"])
        assertEquals("Ruiz", paciente["apellidos"])
        assertEquals("1712345678", paciente["cedula"])
        assertEquals("61.5", paciente["peso"])
        assertEquals("sí", paciente["fumador"])
        assertNull(paciente["alergias"])
        assertNull(paciente["vacio"])
        assertNull(paciente["regiones"])
        assertEquals(JsonArray(listOf(JsonPrimitive("torax"))), paciente.data["regiones"])
    }

    @Test
    fun registroSinData() {
        val registro = decodificar<Registro>("""{"id":"r1","title":null}""")
        assertTrue(registro.data.isEmpty())
        assertNull(registro.title)
    }

    @Test
    fun colaDeRevisionYAsignaciones() {
        val cola = decodificar<ColaRevision>(
            """{"ok":true,"patient_ids":["p1"],"by_patient":{"p1":{"pending":2,"earliest_due":"2026-09-15T10:00:00.000Z"}}}""",
        )
        assertEquals(2, cola.porPaciente["p1"]?.pendientes)

        val asignaciones = decodificar<Asignaciones>(
            """{"ok":true,"assignments":{"p1":{"assignee_id":"u9","assignee_name":"Dr. Mora","source":"derivado_grupo","estado":"derivada"}}}""",
        )
        assertEquals("Dr. Mora", asignaciones.porPaciente["p1"]?.nombre)
        assertEquals("derivado_grupo", asignaciones.porPaciente["p1"]?.origen)
        assertEquals("derivada", asignaciones.porPaciente["p1"]?.estado)
        // PAPER §39: sin `mine` (backend anterior), ningún paciente es mío.
        assertTrue(asignaciones.mine.isEmpty())
        val conMios = decodificar<Asignaciones>(
            """{"ok":true,"assignments":{"p1":{"estado":"derivada"}},"mine":["p1","p7"]}""",
        )
        assertEquals(listOf("p1", "p7"), conMios.mine)
        // Sin `prioridad` (backend anterior o consulta sin clasificar): no hay chip.
        assertNull(asignaciones.porPaciente["p1"]?.prioridad)

        // PAPER §34: la prioridad clínica de la consulta alimenta el chip de la fila.
        val conPrioridad = decodificar<Asignaciones>(
            """{"ok":true,"assignments":{"p1":{"assignee_id":"u9","assignee_name":"Dr. Mora","source":"responsable",
               "estado":"en_curso","prioridad":"Urgente","derivados":[]},
               "p2":{"assignee_name":"Dra. Paz","estado":"en_curso","prioridad":null},
               "p3":{"estado":"en_curso","prioridad":"Programada"}}}""",
        )
        assertEquals("Urgente", conPrioridad.porPaciente["p1"]?.prioridad)
        assertEquals(ClinicalPriority.Urgent, ClinicalPriority.of(conPrioridad.porPaciente["p1"]?.prioridad))
        assertNull(ClinicalPriority.of(conPrioridad.porPaciente["p2"]?.prioridad))
        assertEquals(ClinicalPriority.Scheduled, ClinicalPriority.of(conPrioridad.porPaciente["p3"]?.prioridad))
        assertNull(ClinicalPriority.of("BLINK"))

        // Derivado a varios: la fila resume los nombres en vez del único "a cargo".
        val varios = decodificar<Asignaciones>(
            """{"ok":true,"assignments":{"p1":{"assignee_name":"Dr. Mora","source":"derivado","estado":"derivada",
               "derivados":[{"id":"u1","name":"Dra. Ramon"},{"id":"u2","name":"Dr. Mora"},{"id":"u3","name":"Dra. Paz"}]}}}""",
        )
        assertEquals("Dra. Ramon, Dr. Mora +1", varios.porPaciente["p1"]?.aCargo)

        // PAPER §35: la fecha del alta; sin la clave (backend anterior) queda null.
        val conAlta = decodificar<Asignaciones>(
            """{"ok":true,"assignments":{"p1":{"estado":"alta","alta_at":"2026-11-09","prioridad":null},
               "p2":{"estado":"en_curso","alta_at":null}}}""",
        )
        assertEquals("2026-11-09", conAlta.porPaciente["p1"]?.dischargedOn)
        assertNull(conAlta.porPaciente["p2"]?.dischargedOn)
        assertNull(asignaciones.porPaciente["p1"]?.dischargedOn)

        val derivaciones = decodificar<Derivaciones>(
            """{"ok":true,"entity_id":"e1","derivados":[{"user_id":"u1","name":"Dra. Ramon","email":"r@cepi.ec"}]}""",
        )
        assertEquals("Dra. Ramon", derivaciones.derivados.single().comoSeLlama)
    }

    @Test
    fun revisadoPorMedico() {
        // GET /api/review-queue/entity/:id con el estado de cada revisor (PAPER §38.1).
        val conRevisados = decodificar<Derivaciones>(
            """{"ok":true,"entity_id":"e1","derivados":[{"reminder_id":"r2","user_id":"u2","name":"Dra. B","email":"b@x.ec","desde":"2026-11-19T10:00:00.000Z"}],"revisados":[{"reminder_id":"r1","user_id":"u1","name":"Dr. A","email":"a@x.ec","revisado_en":"2026-11-19T11:00:00.000Z"}]}""",
        )
        assertEquals(listOf("u2"), conRevisados.derivados.map { it.usuario })
        assertEquals("Dra. B", conRevisados.derivados.single().comoSeLlama)
        val revisado = conRevisados.revisados.single()
        assertEquals("u1", revisado.usuario)
        assertEquals("Dr. A", revisado.comoSeLlama)
        assertEquals("2026-11-19T11:00:00.000Z", revisado.reviewedAt)

        // Un servidor anterior a §38 no manda `revisados`.
        val sinRevisados = decodificar<Derivaciones>(
            """{"ok":true,"entity_id":"e1","derivados":[{"reminder_id":"r2","user_id":"u2","name":"Dra. B","email":"b@x.ec","desde":"2026-11-19T10:00:00.000Z"}]}""",
        )
        assertEquals(1, sinRevisados.derivados.size)
        assertTrue(sinRevisados.revisados.isEmpty())

        // POST /api/entities/:id/complete_review: cuerpo y respuesta.
        assertEquals("""{"only_mine":true}""", CepiApi.markReviewedBody().toString())
        val cierre = decodificar<Uno<ReviewCompletion>>(
            """{"ok":true,"data":{"entity_id":"e1","cleared":1,"remaining":2}}""",
        ).data
        assertEquals("e1", cierre.entityId)
        assertEquals(1, cierre.cleared)
        assertEquals(2, cierre.remaining)
    }

    @Test
    fun loTomo() {
        // PAPER §38.3: responsable y permisos en GET /api/review-queue/entity/:id.
        val conResponsable = decodificar<Derivaciones>(
            """{"ok":true,"entity_id":"e1","derivados":[],"revisados":[],
               "responsable":{"user_id":"u9","name":"Dra. Paz","email":"p@x.ec"},"can_claim":true,"can_reassign":true}""",
        )
        assertEquals("u9", conResponsable.responsable?.usuario)
        assertEquals("Dra. Paz", conResponsable.responsable?.comoSeLlama)
        assertTrue(conResponsable.canClaim)
        assertTrue(conResponsable.canReassign)

        val sinResponsable = decodificar<Derivaciones>(
            """{"ok":true,"entity_id":"e1","derivados":[],"responsable":null,"can_claim":true,"can_reassign":false}""",
        )
        assertNull(sinResponsable.responsable)
        assertTrue(sinResponsable.canClaim)
        assertFalse(sinResponsable.canReassign)

        // Servidor anterior a §38.3: sin las tres claves.
        val viejo = decodificar<Derivaciones>("""{"ok":true,"entity_id":"e1","derivados":[]}""")
        assertNull(viejo.responsable)
        assertFalse(viejo.canClaim)
        assertFalse(viejo.canReassign)

        // El cuerpo del claim: solo una consulta enviada pasa a en_triage.
        assertEquals("""{"status_value":"en_triage"}""", CepiApi.claimBody("enviada").toString())
        assertEquals("{}", CepiApi.claimBody("en_triage").toString())
        assertEquals("{}", CepiApi.claimBody(null).toString())
        val tomada = decodificar<Uno<ClaimResult>>(
            """{"ok":true,"data":{"entity_id":"e1","responsable_actual_id":"u1","new_status":"en_triage"}}""",
        ).data
        assertEquals("e1", tomada.entityId)
        assertEquals("u1", tomada.ownerId)
        assertEquals("en_triage", tomada.newStatus)

        // La línea «A cargo» y la confirmación.
        assertEquals("Sin responsable", CaseReview.ownerLabel(null, "u1"))
        assertEquals("A cargo: tú", CaseReview.ownerLabel(conResponsable.responsable, "u9"))
        assertEquals("A cargo: Dra. Paz", CaseReview.ownerLabel(conResponsable.responsable, "u1"))
        assertEquals("Dra. Paz la tiene a cargo. ¿La revisas tú?", CaseReview.confirmQuestion("Dra. Paz"))
    }

    /** PAPER §38.4: el único botón «🙋 Revisar» / «✓ Revisado», en el orden de `IntakeChat.vue`. */
    @Test
    fun unSoloBotonRevisar() {
        fun refs(
            derivados: List<String> = emptyList(),
            revisados: List<String> = emptyList(),
            owner: String? = null,
            canClaim: Boolean = false,
            canReassign: Boolean = false,
        ) = Derivaciones(
            derivados = derivados.map { Derivado(it, "Dr. $it") },
            revisados = revisados.map { Revisado(it, "Dr. $it") },
            responsable = owner?.let { Responsable(it, "Dr. $it") },
            canClaim = canClaim,
            canReassign = canReassign,
        )
        fun st(r: Derivaciones, user: String? = "yo", episode: String? = "e1", active: Boolean = true, status: String? = "derivada") =
            CaseReview.state(r, user, episode, active, status)

        // 1. Sin consulta activa. 2. Consulta anterior.
        assertEquals(CaseReview.State.Disabled(CaseReview.NO_EPISODE), st(refs(derivados = listOf("yo")), episode = null))
        assertEquals(CaseReview.State.Disabled(CaseReview.NOT_ACTIVE), st(refs(derivados = listOf("yo")), active = false))
        // 3. Hecho: ya lo revisé, o es mía sin revisión abierta (aunque no tenga can_claim).
        assertEquals(CaseReview.State.Done(), st(refs(revisados = listOf("yo"))))
        assertEquals(CaseReview.State.Done(), st(refs(owner = "yo", canClaim = true)))
        // Con revisión abierta y mía, no está hecho: se apaga mi «revisar» sin tomar.
        assertEquals(CaseReview.State.Action(take = false, close = true, confirmOwner = null), st(refs(derivados = listOf("yo"), owner = "yo", canClaim = true)))
        // 4. Sin revisión abierta ni permiso de tomar: oculto.
        assertEquals(CaseReview.State.Hidden, st(refs(owner = "otro")))
        assertEquals(CaseReview.State.Hidden, st(refs()))
        // 5. Cargando. 6. Alta.
        assertEquals(CaseReview.State.Disabled(CaseReview.LOADING), st(refs(canClaim = true), status = null))
        assertEquals(CaseReview.State.Disabled(CaseReview.DISCHARGED), st(refs(derivados = listOf("yo")), status = "alta"))
        // 7. La tiene otro, no es para mí y no puedo reasignar.
        assertEquals(CaseReview.State.Disabled("La tiene a cargo Dr. otro"), st(refs(owner = "otro", canClaim = true)))
        // 8. Acciones.
        assertEquals(CaseReview.State.Action(take = true, close = false, confirmOwner = null), st(refs(canClaim = true), status = "enviada"))
        assertEquals(
            CaseReview.State.Action(take = true, close = false, confirmOwner = "Dr. otro"),
            st(refs(owner = "otro", canClaim = true, canReassign = true)),
        )
        assertEquals(
            CaseReview.State.Action(take = true, close = true, confirmOwner = null),
            st(refs(derivados = listOf("yo"), canClaim = true)),
        )
        // Revisión abierta sin permiso de tomar, la tiene otro: solo se apaga mi «revisar».
        assertEquals(
            CaseReview.State.Action(take = false, close = true, confirmOwner = null),
            st(refs(derivados = listOf("yo"), owner = "otro")),
        )
        // Sin usuario no hay nada mío.
        assertEquals(CaseReview.State.Hidden, st(refs(derivados = listOf("yo")), user = null))

        // Los avisos al terminar.
        assertEquals(CaseReview.CONFIRMATION_TAKEN, CaseReview.confirmation(true))
        assertEquals(CaseReview.CONFIRMATION_CLOSED, CaseReview.confirmation(false))
    }

    @Test
    fun fichaDeEvolucion() {
        // GET /api/patient-evolution (PAPER §28); el mismo cuerpo que ContratoTests.swift.
        val filas = decodificar<Lista<FilaEvolucion>>(
            """{"ok":true,"data":[
               {"episode_id":"e2","fecha":"2026-10-01","estado":"cerrado","medico":"Dra. Ana Pérez",
                "especialista":"Dr. Luis Mora","diagnostico":"L40.0 — Psoriasis vulgar",
                "diagnostico_histopatologico":"Psoriasis psoriasiforme","tratamiento":"Clobetasol 0,05 %",
                "observaciones":"Control en 3 meses"},
               {"episode_id":"e1","fecha":"2026-08-15","estado":"en_curso","medico":null,
                "especialista":null,"diagnostico":null,"diagnostico_histopatologico":null,
                "tratamiento":null,"observaciones":null},
               {"episode_id":"e0","fecha":"2026-07-01"}]}""",
        ).data
        assertEquals(listOf("e2", "e1", "e0"), filas.map { it.episodio })
        assertEquals("2026-10-01", filas[0].fecha)
        assertEquals("Dra. Ana Pérez", filas[0].medico)
        assertEquals("L40.0 — Psoriasis vulgar", filas[0].diagnostico)
        assertEquals("Clobetasol 0,05 %", filas[0].tratamiento)
        assertEquals("Dr. Luis Mora", filas[0].especialista)
        assertEquals("Psoriasis psoriasiforme", filas[0].diagnosticoHistopatologico)
        assertEquals("Control en 3 meses", filas[0].observaciones)
        assertNull(filas[1].diagnostico)
        assertNull(filas[1].medico)
        assertNull(filas[1].especialista)
        assertNull(filas[1].diagnosticoHistopatologico)
        assertNull(filas[1].observaciones)
        // Un backend anterior no manda los campos nuevos: no rompe.
        assertNull(filas[2].especialista)
        assertNull(filas[2].diagnosticoHistopatologico)
        assertNull(filas[2].observaciones)
        assertNull(filas[2].estado)
    }

    @Test
    fun dischargeContract() {
        // POST /api/bot/episodio/alta (PAPER §35.2); el mismo cuerpo que ContratoTests.swift.
        assertEquals(
            """{"episode_id":"e1","nota":"Lesión resuelta"}""",
            CepiApi.dischargeBody("e1", "  Lesión resuelta\n").toString(),
        )
        assertEquals("""{"episode_id":"e1","nota":""}""", CepiApi.dischargeBody("e1", "").toString())
    }

    @Test
    fun consultationAnswerContract() {
        // POST /api/bot/interconsulta/responder (PAPER §30.2).
        val cuerpo = CepiApi.answerConsultationBody("e2", "Biopsia escisional", "D22.5 — Nevus atípico", "", "Control en 6 meses")
        assertEquals(
            """{"episode_id":"e2","recomendacion":"Biopsia escisional","diagnostico":"D22.5 — Nevus atípico","tratamiento":"","observaciones":"Control en 6 meses","prioridad":""}""",
            cuerpo.toString(),
        )
        // PAPER §34: la prioridad elegida viaja como `prioridad`.
        val conPrioridad = CepiApi.answerConsultationBody(
            "e2", "Biopsia escisional", "D22.5 — Nevus atípico", "", "", ClinicalPriority.Preferred.value,
        )
        assertEquals(
            """{"episode_id":"e2","recomendacion":"Biopsia escisional","diagnostico":"D22.5 — Nevus atípico","tratamiento":"","observaciones":"","prioridad":"Preferente"}""",
            conPrioridad.toString(),
        )
        assertEquals(listOf("Urgente", "Preferente", "Programada"), ClinicalPriority.entries.map { it.value })
        val respuesta = decodificar<ec.cepi.telemedicina.api.ConsultationAnswerResult>("""{"ok":true,"notified":true,"episode_id":"e2"}""")
        assertTrue(respuesta.ok)
        assertTrue(respuesta.notified)
        assertEquals(false, decodificar<ec.cepi.telemedicina.api.ConsultationAnswerResult>("""{"ok":true}""").notified)
    }

    @Test
    fun consentsContract() {
        // GET /api/bot/consentimientos (PAPER §31.2): los dos tipos, y un registro viejo sin foto.
        val lista = decodificar<ec.cepi.telemedicina.api.ConsentList>(
            """
            {"ok":true,
             "informado":[{"id":"c1","attachment_id":"a1","fecha":"2026-11-09","subido_por":"Dra. Pérez"},
                          {"id":"c0","attachment_id":null,"fecha":null,"subido_por":null}],
             "privacidad_datos":[{"id":"c2","attachment_id":"a2","fecha":"2026-11-08","subido_por":"Dr. Ruiz"}]}
            """,
        )
        assertEquals(2, lista.informado.size)
        assertEquals("a1", lista.informado[0].attachmentId)
        assertEquals("2026-11-09", lista.informado[0].fecha)
        assertEquals("Dra. Pérez", lista.informado[0].uploadedBy)
        assertEquals("c0", lista.informado[1].id)
        assertNull(lista.informado[1].attachmentId)
        assertNull(lista.informado[1].fecha)
        assertNull(lista.informado[1].uploadedBy)
        assertEquals(1, lista.privacidadDatos.size)
        assertEquals("a2", lista.privacidadDatos[0].attachmentId)
        assertEquals("Dr. Ruiz", lista.privacidadDatos[0].uploadedBy)
        // Un tipo que el backend no manda queda vacío.
        assertTrue(decodificar<ec.cepi.telemedicina.api.ConsentList>("""{"ok":true,"informado":[]}""").privacidadDatos.isEmpty())

        // POST /api/bot/consentimientos.
        assertEquals(
            """{"patient_id":"p1","tipo":"privacidad_datos","attachment_ids":["a1","a2"]}""",
            CepiApi.consentsBody("p1", "privacidad_datos", listOf("a1", "a2")).toString(),
        )
        assertEquals(
            """{"patient_id":"p1","tipo":"informado","attachment_ids":["a3"]}""",
            CepiApi.consentsBody("p1", "informado", listOf("a3")).toString(),
        )
        val guardado = decodificar<ec.cepi.telemedicina.api.ConsentSaveResult>("""{"ok":true,"ids":["c3","c4"],"errors":[]}""")
        assertTrue(guardado.ok)
        assertEquals(listOf("c3", "c4"), guardado.ids)
        assertTrue(guardado.errors.isEmpty())
    }

    @Test
    fun observationsRequestBody() {
        // POST /api/bot/ficha/grupo desde la sección Evolución (grupo g_7, PAPER §28).
        val cuerpo = CepiApi.observationsBody("p1", "e2", "Control en 3 meses \"sin\" cambios")
        assertEquals(
            """{"group_id":"g_7","data":{"observaciones":"Control en 3 meses \"sin\" cambios"},"episode_id":"e2","patient_id":"p1"}""",
            cuerpo.toString(),
        )
    }

    @Test
    fun urlCodificaElMas() {
        val url = ApiClient.url(
            "https://telemedicina.cepi.ec".toHttpUrl(),
            "/api/entities",
            listOf("q" to "a+b ñ", "filter[patient_id]" to "p1", "vacio" to null),
        )
        assertTrue(url.toString().startsWith("https://telemedicina.cepi.ec/api/entities?"))
        assertTrue(url.encodedQuery!!, url.encodedQuery!!.contains("q=a%2Bb%20%C3%B1"))
        assertEquals("a+b ñ", url.queryParameter("q"))
        assertEquals("p1", url.queryParameter("filter[patient_id]"))
        assertNull(url.queryParameter("vacio"))
    }
}
