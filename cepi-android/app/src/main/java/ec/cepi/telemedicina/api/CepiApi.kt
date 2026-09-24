package ec.cepi.telemedicina.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

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

    /** Alta mínima; `title` = "Nombre Apellidos" para que sea ubicable por nombre en el ERP. */
    suspend fun crearPaciente(nombre: String, apellidos: String, cedula: String): Registro =
        cliente.post<Uno<Registro>>("/api/entities", buildJsonObject {
            put("record_type", "business")
            put("entity_id", DEFINICION_PACIENTE)
            put("title", "$nombre $apellidos".trim())
            putJsonObject("data") {
                put("nombre", nombre)
                put("apellidos", apellidos)
                put("cedula", cedula)
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

    suspend fun chat(mensaje: String, sesion: String?): RespuestaChat =
        RespuestaChat.desde(cliente.post<JsonObject>("/api/bot/chat", buildJsonObject {
            put("message", mensaje)
            if (sesion != null) put("session_id", sesion)
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
    }
}
