package ec.cepi.telemedicina.api

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

    companion object {
        const val DEFINICION_PACIENTE = "11000000-0000-0000-0000-000000000000"
        const val DEFINICION_EPISODIO = "12000000-0000-0000-0000-000000000000"
        const val PERMISO_BORRAR_PACIENTE = "entity:$DEFINICION_PACIENTE:record:delete"
    }
}
