package ec.cepi.telemedicina

import ec.cepi.telemedicina.api.Asignacion
import ec.cepi.telemedicina.api.PendienteRevision
import ec.cepi.telemedicina.api.Registro
import ec.cepi.telemedicina.api.jsonCepi
import ec.cepi.telemedicina.pacientes.EstadoFicha
import ec.cepi.telemedicina.pacientes.FilaPaciente
import ec.cepi.telemedicina.pacientes.PacientesModelo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los de `PacientesTests.swift`: orden, estado de la ficha, búsqueda y nombre de la fila. */
class PacientesTest {
    private fun registro(
        id: String,
        nombre: String? = null,
        apellidos: String? = null,
        cedula: String? = null,
        title: String? = null,
    ): Registro {
        val data = listOfNotNull(
            nombre?.let { "\"nombre\":\"$it\"" },
            apellidos?.let { "\"apellidos\":\"$it\"" },
            cedula?.let { "\"cedula\":\"$it\"" },
        ).joinToString(",")
        val titulo = title?.let { ",\"title\":\"$it\"" }.orEmpty()
        return jsonCepi.decodeFromString("""{"id":"$id","data":{$data}$titulo}""")
    }

    @Test
    fun revisarPrimeroYLoQueVenceAntes() {
        val filas = listOf("a", "b", "c", "d", "e").map { FilaPaciente(registro(it, nombre = it)) }
        val revision = mapOf(
            "c" to PendienteRevision(1, "2026-09-20T10:00:00.000Z"),
            "d" to PendienteRevision(2, "2026-09-15T10:00:00Z"),
            "e" to PendienteRevision(1, null),
        )
        assertEquals(listOf("d", "c", "e", "a", "b"), PacientesModelo.ordenar(filas, revision).map { it.id })
    }

    @Test
    fun primeroPorEstadoYDentroDelEstadoRevisar() {
        val filas = listOf("a", "b", "c", "d", "e", "f").map { FilaPaciente(registro(it, nombre = it)) }
        val asignaciones = mapOf(
            "a" to Asignacion(estado = "cerrado"),
            "b" to Asignacion(estado = "respondida"),
            "c" to Asignacion(estado = "en_curso"),
            "e" to Asignacion(estado = "en_curso"),
            "f" to Asignacion(estado = "en_revisión_solicitada"),
        )
        val revision = mapOf("e" to PendienteRevision(1, null))
        assertEquals(
            listOf("b", "f", "e", "c", "a", "d"),
            PacientesModelo.ordenar(filas, revision, asignaciones).map { it.id },
        )
    }

    @Test
    fun estadoDeLaFicha() {
        assertEquals(EstadoFicha.SinConsulta, EstadoFicha.de(null))
        assertEquals(EstadoFicha.SinConsulta, EstadoFicha.de(" "))
        assertEquals(EstadoFicha.Derivada, EstadoFicha.de("derivada"))
        assertEquals(EstadoFicha.RevisionSolicitada, EstadoFicha.de("en_revisión_solicitada"))
        assertEquals(EstadoFicha.Agendada, EstadoFicha.de("agendado"))
        // Un estado que la app no conoce no rompe la lista: cae en "Otro estado".
        assertEquals(EstadoFicha.Otro, EstadoFicha.de("archivada"))
    }

    @Test
    fun busquedaSinTildesNiMayusculas() {
        val fila = FilaPaciente(registro("p", nombre = "José", apellidos = "Núñez", cedula = "0912345678"))
        assertTrue(fila.claveBusqueda.contains(FilaPaciente.normalizar("JOSE nunez")))
        assertTrue(fila.claveBusqueda.contains("0912"))
        assertEquals("JN", fila.iniciales)
    }

    @Test
    fun sinNombreUsaElTitulo() {
        val fila = FilaPaciente(registro("p", title = "Paciente importado"))
        assertEquals("Paciente importado", fila.nombre)
        assertNull(fila.cedula)
    }

    @Test
    fun filtrarYAltaLocal() {
        val modelo = PacientesModelo()
        modelo.insertar(registro("p1", nombre = "Ana", apellidos = "Ruiz"))
        modelo.insertar(registro("p2", nombre = "Ángel", apellidos = "Mora", cedula = "1712"))
        modelo.insertar(registro("p2", nombre = "Duplicado"))

        assertEquals(listOf("p2", "p1"), modelo.filas.map { it.id })
        assertEquals(listOf("p2"), modelo.filtradas("  angel ").map { it.id })
        assertEquals(listOf("p2"), modelo.filtradas("171").map { it.id })
        assertEquals(2, modelo.filtradas("").size)
    }
}
