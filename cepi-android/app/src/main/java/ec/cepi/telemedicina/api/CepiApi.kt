package ec.cepi.telemedicina.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.time.LocalDate

/** Los endpoints que usa la app, con tipos. Contrato completo en PAPER §24.4 y §25.4. */
class CepiApi(val cliente: ApiClient) {

    // Sesión

    suspend fun login(email: String, password: String): SesionRespuesta =
        cliente.post("/api/auth/login", buildJsonObject {
            put("email", email)
            put("password", password)
        })

    /** Cambia el ID token de Google por la sesión de CEPI (cuenta nueva → rol pendiente). */
    suspend fun loginGoogle(idToken: String): SesionRespuesta =
        cliente.post("/api/auth/google", buildJsonObject { put("credential", idToken) })

    suspend fun yo(): SesionRespuesta = cliente.get("/api/auth/me")

    suspend fun cambiarOrganizacion(id: String): TokenRespuesta =
        cliente.post("/api/orgs/switch", buildJsonObject { put("org_id", id) })

    /**
     * Borra la cuenta propia (Play y App Store lo exigen). Sin `confirm: true` en el cuerpo el
     * backend no borra nada. Las historias clínicas se conservan (PAPER §24.7).
     */
    suspend fun eliminarCuenta() {
        cliente.delete<Confirmacion>("/api/auth/me", buildJsonObject { put("confirm", true) })
    }

    // Pacientes

    /**
     * Todos de una vez, como `listPatients` en la web: 500 filas son pocas para una
     * `LazyColumn` y así la búsqueda es local e instantánea. La PII llega redactada según el rol.
     */
    suspend fun pacientes(limite: Int = 500): List<Registro> =
        cliente.get<Lista<Registro>>(
            "/api/entities",
            "type" to "business",
            "entity_id" to DEFINICION_PACIENTE,
            "limit" to limite.toString(),
        ).data

    /**
     * Alta mínima; `title` = "Nombre Apellidos" para que sea ubicable por nombre en el ERP. El
     * celular va en `telefono` (PAPER §36.1); el email solo si se escribió.
     */
    suspend fun crearPaciente(nombre: String, apellidos: String, cedula: String, celular: String, email: String = ""): Registro =
        cliente.post<Uno<Registro>>("/api/entities", buildJsonObject {
            put("record_type", "business")
            put("entity_id", DEFINICION_PACIENTE)
            put("title", "$nombre $apellidos".trim())
            putJsonObject("data") {
                put("nombre", nombre)
                put("apellidos", apellidos)
                put("cedula", cedula)
                put("telefono", celular)
                if (email.isNotBlank()) put("email", email)
            }
            put("active", true)
        }).data

    suspend fun colaRevision(): Map<String, PendienteRevision> =
        cliente.get<ColaRevision>("/api/review-queue").porPaciente

    suspend fun asignaciones(): Map<String, Asignacion> =
        cliente.get<Asignaciones>("/api/patient-assignments").porPaciente

    /**
     * Borrado suave del paciente (D-Aux-23): solo lo permite el backend a quien tiene el
     * permiso. La historia clínica no se pierde y el registro reaparece si se crea de nuevo.
     */
    suspend fun eliminarPaciente(id: String) {
        cliente.delete<Confirmacion>("/api/entities/$id")
    }

    // Hilo y chat

    /** El hilo del paciente: los mensajes de todos los profesionales y del bot, en orden. */
    suspend fun hilo(paciente: String): List<MensajeHilo> =
        cliente.get<HiloRespuesta>("/api/patient-thread", "patient_id" to paciente).mensajes

    suspend fun sesionesBot(paciente: String): List<SesionBot> =
        cliente.get<SesionesBot>("/api/bot/sessions", "patient_id" to paciente).sesiones

    /**
     * `explicito`: lo disparó el usuario desde un botón (derivar, enviar caso…), así que el
     * bot lo ejecuta sin pedir sí/no.
     */
    suspend fun chat(mensaje: String, sesion: String?, explicito: Boolean = false): RespuestaChat =
        RespuestaChat.desde(cliente.post<JsonObject>("/api/bot/chat", buildJsonObject {
            put("message", mensaje)
            if (sesion != null) put("session_id", sesion)
            if (explicito) put("explicit", true)
        }))

    /**
     * Un envío estructurado (`ficha_grp_*`, `ficha_goto`, `ficha_save`): no lleva texto, es la
     * acción explícita del usuario y el bot la guarda sin pedir sí/no.
     */
    suspend fun enviarFormulario(
        formId: String,
        datos: JsonObject,
        sesion: String?,
        episodio: String? = null,
    ): RespuestaChat =
        RespuestaChat.desde(cliente.post<JsonObject>("/api/bot/chat", buildJsonObject {
            put("message", "")
            if (sesion != null) put("session_id", sesion)
            putJsonObject("form_submission") {
                put("form_id", formId)
                put("data", datos)
                if (episodio != null) put("episode_id", episodio)
            }
        }))

    /**
     * Guarda las observaciones de una ficha desde la sección Evolución (grupo `g_7`, PAPER §28).
     * Es un envío explícito del usuario: cepi-bot lo guarda sin pedir sí/no.
     */
    suspend fun saveObservations(paciente: String, episodio: String, texto: String) {
        cliente.post<Confirmacion>("/api/bot/ficha/grupo", observationsBody(paciente, episodio, texto))
    }

    /**
     * La ficha completa de un caso (pestaña Ficha, PAPER §24.2.1): los grupos en orden con lo que
     * tienen cargado. Sin episodio salen solo los grupos del paciente con dato.
     */
    suspend fun fullFicha(episodeId: String?, patientId: String?): FullFicha =
        cliente.get("/api/bot/ficha", "episode_id" to episodeId, "patient_id" to patientId)

    /**
     * Guarda UN grupo de la ficha desde la pestaña Ficha. Es el envío explícito del formulario:
     * cepi-bot lo guarda sin pedir sí/no, por el mismo camino que el chat (coerciones y campos
     * derivados iguales). Un payload inválido llega como `ApiError` 400 con el motivo.
     */
    suspend fun saveFichaGroup(groupId: String, data: JsonObject, episodeId: String?, patientId: String?): FichaGroupSaveResult =
        cliente.post("/api/bot/ficha/grupo", fichaGroupBody(groupId, data, episodeId, patientId))

    /**
     * «Responder interconsulta» (PAPER §30.2). Acción explícita: cepi-bot la guarda sin pedir
     * sí/no. Un 409 (la consulta no espera especialista, o la envió quien responde) llega como
     * `ApiError` con el mensaje del servidor.
     */
    suspend fun answerConsultation(
        episodio: String,
        recomendacion: String,
        diagnostico: String,
        tratamiento: String,
        observaciones: String,
        prioridad: String,
    ): ConsultationAnswerResult =
        cliente.post(
            "/api/bot/interconsulta/responder",
            answerConsultationBody(episodio, recomendacion, diagnostico, tratamiento, observaciones, prioridad),
        )

    /**
     * «Dar de alta» (PAPER §35.2). Acción explícita: cepi-bot la guarda sin pedir sí/no. Un 409
     * (ya estaba de alta) llega como `ApiError` con el mensaje del servidor.
     */
    suspend fun dischargePatient(episodio: String, nota: String) {
        cliente.post<Confirmacion>("/api/bot/episodio/alta", dischargeBody(episodio, nota))
    }

    /**
     * «＋ Agregar evolución» a una ficha (PAPER §28.4). Acción explícita: cepi-bot la guarda sin
     * pedir sí/no. 400 si no trae hallazgos, diagnóstico, tratamiento ni observaciones; 409 si la
     * ficha está de alta. Ambos llegan como `ApiError` con el mensaje del servidor.
     */
    suspend fun addEvolution(
        episodeId: String,
        fecha: String?,
        hallazgos: String?,
        diagnostico: String?,
        tratamiento: String?,
        observaciones: String?,
        proximoControlFecha: String?,
        proximoControlMotivo: String?,
    ): AddEvolutionResult =
        cliente.post(
            "/api/bot/episodio/evolucion",
            addEvolutionBody(episodeId, fecha, hallazgos, diagnostico, tratamiento, observaciones, proximoControlFecha, proximoControlMotivo),
        )

    /** El ✏️ de observaciones de una evolución registrada (PAPER §28.4). */
    suspend fun editEvolution(evolutionId: String, observaciones: String) {
        cliente.post<Confirmacion>("/api/bot/evolucion/editar", editEvolutionBody(evolutionId, observaciones))
    }

    // Registros

    suspend fun entidad(id: String): Registro = cliente.get<Uno<Registro>>("/api/entities/$id").data

    /** Las consultas del paciente, de la más nueva a la más vieja. */
    suspend fun episodios(paciente: String): List<Registro> =
        cliente.get<Lista<Registro>>(
            "/api/entities",
            "type" to "business",
            "entity_id" to DEFINICION_EPISODIO,
            "limit" to "100",
            "filter[patient_id]" to paciente,
        ).data.sortedByDescending { it["fecha"].orEmpty() }

    /** Ficha de evolución: fecha, médico, diagnóstico y tratamiento de cada ficha (PAPER §28). */
    suspend fun evolucion(paciente: String): List<FilaEvolucion> =
        cliente.get<Lista<FilaEvolucion>>("/api/patient-evolution", "patient_id" to paciente).data

    /** Búsqueda de texto en una definición, paginada (campo `entity_search`). */
    suspend fun buscar(definicion: String, texto: String, desde: Int, limite: Int): List<Registro> =
        cliente.get<Lista<Registro>>(
            "/api/entities",
            "type" to "business",
            "entity_id" to definicion,
            "q" to texto,
            "limit" to limite.toString(),
            "offset" to desde.toString(),
        ).data

    suspend fun buscarCIE10(texto: String): List<ResultadoCIE> =
        cliente.get<BusquedaCIE>("/api/icd10/search", "q" to texto).results

    // Derivar

    suspend fun grupos(): List<GrupoDerivacion> = cliente.get<Lista<GrupoDerivacion>>("/api/groups").data

    suspend fun miembros(grupo: String): List<MiembroGrupo> =
        cliente.get<Lista<MiembroGrupo>>("/api/groups/$grupo/members").data

    // Turnos de un grupo (PAPER §32)

    /** Los turnos que tocan el rango `from`–`to` (ambos incluidos), con el «hoy» del servidor. */
    suspend fun shifts(group: String, from: LocalDate, to: LocalDate): ShiftList =
        cliente.get("/api/groups/$group/shifts", "from" to from.toString(), "to" to to.toString())

    /** Exige `groups:manage_shifts`; un 400/403/404 llega como `ApiError` con el mensaje del servidor. */
    suspend fun createShift(group: String, userId: String, startsOn: LocalDate, endsOn: LocalDate): Shift =
        cliente.post<Uno<Shift>>("/api/groups/$group/shifts", shiftBody(userId, startsOn, endsOn)).data

    suspend fun deleteShift(group: String, id: String) {
        cliente.delete<Confirmacion>("/api/groups/$group/shifts/$id")
    }

    /** A quién está derivado el episodio ahora mismo. */
    suspend fun derivaciones(episodio: String): List<Derivado> =
        cliente.get<Derivaciones>("/api/review-queue/entity/$episodio").derivados

    // Galería y adjuntos

    /**
     * Imágenes clínicas de la organización activa, con búsqueda por texto (paciente, cédula,
     * diagnóstico, CIE-10 o fecha) y, opcionalmente, de un solo paciente (PAPER §24.2.1).
     */
    suspend fun galeria(texto: String = "", paciente: String? = null, limite: Int = 60, desde: Int = 0): RespuestaGaleria =
        cliente.get(
            "/api/bot/galeria",
            "limit" to limite.toString(),
            "offset" to desde.toString(),
            "q" to texto.trim().ifEmpty { null },
            "patient_id" to paciente,
        )

    suspend fun subirImagen(jpeg: ByteArray, nombre: String): Adjunto =
        cliente.subir("/api/attachments", jpeg, nombre, "image/jpeg")

    // Consentimientos del paciente (PAPER §31)

    suspend fun consents(paciente: String): ConsentList =
        cliente.get("/api/bot/consentimientos", "patient_id" to paciente)

    /**
     * Un registro `consent` por foto ya subida (`subirImagen`). Subir es la acción explícita del
     * usuario: cepi-bot lo guarda sin pedir sí/no. `tipo`: `informado` o `privacidad_datos`.
     */
    suspend fun saveConsents(paciente: String, tipo: String, adjuntos: List<String>): ConsentSaveResult =
        cliente.post("/api/bot/consentimientos", consentsBody(paciente, tipo, adjuntos))

    // Próximos controles de los pacientes (PAPER §33)

    /** Los controles de la org activa en la ventana del servidor (atrasados y próximos 90 días). */
    suspend fun followUps(): FollowUpList = cliente.get("/api/bot/controles")

    // Avisos y push

    /** La bandeja es personal: aunque el rol lea todos, se pide solo lo del usuario (como la web). */
    suspend fun recordatorios(usuario: String): List<Recordatorio> =
        cliente.get<Lista<Recordatorio>>("/api/reminders", "owner_user_id" to usuario).data

    suspend fun completarRecordatorio(id: String) {
        cliente.post<Confirmacion>("/api/reminders/$id/complete", buildJsonObject {})
    }

    suspend fun pacienteDeAviso(entidad: String): PacienteDeAviso = cliente.get("/api/review-queue/patient/$entidad")

    suspend fun registrarDispositivo(token: String) {
        cliente.post<Confirmacion>("/api/push/device-token", buildJsonObject {
            put("platform", "android")
            put("token", token)
        })
    }

    suspend fun olvidarDispositivo(token: String) {
        cliente.delete<Confirmacion>("/api/push/device-token", buildJsonObject { put("token", token) })
    }

    /** Dónde está el archivo de un adjunto; lo pide el cargador de imágenes con el token. */
    fun urlAdjunto(id: String): String = cliente.url("/api/attachments/$id/file").toString()

    companion object {
        const val DEFINICION_PACIENTE = "11000000-0000-0000-0000-000000000000"
        const val DEFINICION_EPISODIO = "12000000-0000-0000-0000-000000000000"
        const val PERMISO_BORRAR_PACIENTE = "entity:$DEFINICION_PACIENTE:record:delete"

        /** El cuerpo de `POST /api/bot/interconsulta/responder`. Sin red, para probarlo. */
        fun answerConsultationBody(
            episodio: String,
            recomendacion: String,
            diagnostico: String,
            tratamiento: String,
            observaciones: String,
            /** Vacío si no se eligió (PAPER §34): el backend no toca la prioridad. */
            prioridad: String = "",
        ): JsonObject = buildJsonObject {
            put("episode_id", episodio)
            put("recomendacion", recomendacion)
            put("diagnostico", diagnostico)
            put("tratamiento", tratamiento)
            put("observaciones", observaciones)
            put("prioridad", prioridad)
        }

        /** El cuerpo de `POST /api/bot/episodio/alta`. Sin red, para probarlo. */
        fun dischargeBody(episodio: String, nota: String): JsonObject = buildJsonObject {
            put("episode_id", episodio)
            put("nota", nota.trim())
        }

        /**
         * El cuerpo de `POST /api/bot/episodio/evolucion`. Lo vacío no se manda: el backend pone
         * hoy en Ecuador si falta la fecha y solo vuelca al episodio lo que trae. Sin red, para
         * probarlo.
         */
        fun addEvolutionBody(
            episodeId: String,
            fecha: String?,
            hallazgos: String?,
            diagnostico: String?,
            tratamiento: String?,
            observaciones: String?,
            proximoControlFecha: String?,
            proximoControlMotivo: String?,
        ): JsonObject = buildJsonObject {
            put("episode_id", episodeId)
            listOf(
                "fecha" to fecha,
                "hallazgos" to hallazgos,
                "diagnostico" to diagnostico,
                "tratamiento" to tratamiento,
                "observaciones" to observaciones,
                "proximo_control_fecha" to proximoControlFecha,
                "proximo_control_motivo" to proximoControlMotivo,
            ).forEach { (key, value) -> value?.trim()?.takeIf { it.isNotEmpty() }?.let { put(key, it) } }
        }

        /** El cuerpo de `POST /api/bot/evolucion/editar`. Vacío borra las observaciones. */
        fun editEvolutionBody(evolutionId: String, observaciones: String): JsonObject = buildJsonObject {
            put("evolution_id", evolutionId)
            put("observaciones", observaciones.trim())
        }

        /** El cuerpo de `POST /api/groups/:slug/shifts`. Sin red, para probarlo. */
        fun shiftBody(userId: String, startsOn: LocalDate, endsOn: LocalDate): JsonObject = buildJsonObject {
            put("user_id", userId)
            put("starts_on", startsOn.toString())
            put("ends_on", endsOn.toString())
        }

        /** El cuerpo de `POST /api/bot/consentimientos`. Sin red, para probarlo. */
        fun consentsBody(paciente: String, tipo: String, adjuntos: List<String>): JsonObject = buildJsonObject {
            put("patient_id", paciente)
            put("tipo", tipo)
            putJsonArray("attachment_ids") { adjuntos.forEach { add(JsonPrimitive(it)) } }
        }

        /** El cuerpo de `POST /api/bot/ficha/grupo` para las observaciones. Sin red, para probarlo. */
        fun observationsBody(paciente: String, episodio: String, texto: String): JsonObject =
            fichaGroupBody("g_7", buildJsonObject { put("observaciones", texto) }, episodio, paciente)

        /** El cuerpo de `POST /api/bot/ficha/grupo`. Sin red, para probarlo. */
        fun fichaGroupBody(groupId: String, data: JsonObject, episodeId: String?, patientId: String?): JsonObject =
            buildJsonObject {
                put("group_id", groupId)
                put("data", data)
                if (episodeId != null) put("episode_id", episodeId)
                if (patientId != null) put("patient_id", patientId)
            }
    }
}
