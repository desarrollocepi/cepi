package ec.cepi.telemedicina.pacientes

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ec.cepi.telemedicina.api.ApiError
import ec.cepi.telemedicina.api.Asignacion
import ec.cepi.telemedicina.api.CepiApi
import ec.cepi.telemedicina.api.Fechas
import ec.cepi.telemedicina.api.PendienteRevision
import ec.cepi.telemedicina.api.Registro
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import java.text.Normalizer
import java.time.Instant
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * Una fila de la lista con lo que la búsqueda y la vista necesitan ya calculado: se arma una
 * vez por carga, no una vez por tecla ni por recomposición.
 */
class FilaPaciente(val registro: Registro) {
    val id: String = registro.id
    val nombre: String
    val cedula: String? = registro["cedula"]
    val iniciales: String
    /** Nombre y cédula sin mayúsculas ni tildes: "jose" encuentra a "José". */
    val claveBusqueda: String

    init {
        val completo = listOfNotNull(registro["nombre"], registro["apellidos"]).joinToString(" ")
        nombre = completo.ifEmpty { registro.title ?: "Paciente" }
        iniciales = nombre.split(' ').filter { it.isNotEmpty() }.take(2).map { it.first() }.joinToString("").uppercase()
        claveBusqueda = normalizar("$nombre ${cedula.orEmpty()}")
    }

    companion object {
        private val marcas = "\\p{Mn}+".toRegex()

        fun normalizar(texto: String): String =
            Normalizer.normalize(texto, Normalizer.Form.NFD).replace(marcas, "").lowercase(Locale.ROOT)
    }
}

/** Lista de pacientes, "revisar" y a cargo. Espejo de `PacientesModelo.swift`. */
class PacientesModelo {
    var filas: List<FilaPaciente> by mutableStateOf(emptyList())
        private set
    var revision: Map<String, PendienteRevision> by mutableStateOf(emptyMap())
        private set
    var asignaciones: Map<String, Asignacion> by mutableStateOf(emptyMap())
        private set
    var cargado: Boolean by mutableStateOf(false)
        private set
    var error: String? by mutableStateOf(null)
        private set

    private var porId: Map<String, FilaPaciente> = emptyMap()
    /** De qué org es lo que hay en `filas`. */
    private var organizacion: String? = null
    /**
     * Cada carga lleva un número; al volver solo se aplica la última. Si se cambia de org
     * justo durante un refresco, lo que llegue de la org anterior se descarta.
     */
    private val pedido = AtomicInteger(0)

    fun fila(id: String): FilaPaciente? = porId[id]

    /**
     * Pacientes, "revisar" y a cargo en paralelo (la web los pide en serie). Si fallan los dos
     * accesorios se conserva lo anterior: un error transitorio no debe borrar los avisos de
     * "revisar".
     */
    suspend fun cargar(api: CepiApi) {
        val mio = pedido.incrementAndGet()
        try {
            val (registros, nuevaCola, nuevasAsignaciones) = supervisorScope {
                val pacientes = async { api.pacientes() }
                val cola = async { intentar { api.colaRevision() } }
                val asignados = async { intentar { api.asignaciones() } }
                Triple(pacientes.await(), cola.await(), asignados.await())
            }
            // Fuera del hilo principal: normalizar y ordenar 500 filas no debe costar un frame.
            val nuevasFilas = withContext(Dispatchers.Default) { preparar(registros, nuevaCola ?: revision) }
            if (mio != pedido.get()) return   // llegó otra carga más nueva (otra org)
            nuevaCola?.let { revision = it }
            nuevasAsignaciones?.let { asignaciones = it }
            filas = nuevasFilas
            porId = nuevasFilas.associateBy { it.id }
            error = null
            cargado = true
        } catch (e: ApiError) {
            // En los refrescos periódicos un fallo no pisa la lista; solo se muestra si nunca
            // llegó a cargar.
            if (mio != pedido.get()) return
            if (!cargado) error = e.mensaje
        }
    }

    /**
     * Otra org es otra lista: se vacía y vuelve a "Cargando pacientes…" en vez de dejar a la
     * vista, y tocable, la lista de la org anterior mientras llega la nueva.
     */
    fun usarOrganizacion(org: String?) {
        if (org == organizacion) return
        val habiaOtra = organizacion != null
        organizacion = org
        if (!habiaOtra) return
        pedido.incrementAndGet()   // lo que llegue de la org anterior se descarta
        filas = emptyList()
        porId = emptyMap()
        revision = emptyMap()
        asignaciones = emptyMap()
        cargado = false
        error = null
    }

    /** Un paciente recién creado aparece ya, sin esperar a la próxima recarga. */
    fun insertar(registro: Registro) {
        if (registro.id in porId) return
        val fila = FilaPaciente(registro)
        filas = listOf(fila) + filas
        porId = porId + (fila.id to fila)
    }

    fun filtradas(busqueda: String): List<FilaPaciente> {
        val consulta = FilaPaciente.normalizar(busqueda.trim())
        if (consulta.isEmpty()) return filas
        return filas.filter { consulta in it.claveBusqueda }
    }

    companion object {
        fun preparar(registros: List<Registro>, revision: Map<String, PendienteRevision>): List<FilaPaciente> =
            ordenar(registros.map(::FilaPaciente), revision)

        /**
         * Primero lo derivado a quien consulta, lo que vence antes arriba; el resto conserva el
         * orden del servidor (`sortedWith` es estable). Misma regla que `filtered` en ChatList.vue.
         */
        fun ordenar(filas: List<FilaPaciente>, revision: Map<String, PendienteRevision>): List<FilaPaciente> {
            val vence = revision.mapValues { Fechas.iso(it.value.vence) ?: Instant.MAX }
            return filas.sortedWith(
                compareBy<FilaPaciente> { if (it.id in vence) 0 else 1 }.thenBy { vence[it.id] ?: Instant.MAX },
            )
        }

        private suspend fun <T> intentar(bloque: suspend () -> T): T? = try {
            bloque()
        } catch (_: ApiError) {
            null
        }
    }
}
