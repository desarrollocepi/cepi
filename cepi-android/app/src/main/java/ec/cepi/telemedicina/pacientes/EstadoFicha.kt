package ec.cepi.telemedicina.pacientes

/**
 * El estado de la consulta más reciente del paciente (`estado` del episodio, que manda
 * `GET /api/patient-assignments`). El orden de la enumeración es el de la lista: del más avanzado
 * en el circuito de telemedicina al menos avanzado, y al final lo cerrado y lo que no tiene
 * consulta (PAPER §24.2.1). `color` es el del LED de la fila, igual en iOS (`EstadoFicha.swift`).
 */
enum class EstadoFicha(val valor: String?, val etiqueta: String, val color: Long) {
    Respondida("respondida", "Respondida", 0xFF16A34A),
    RevisionSolicitada("en_revisión_solicitada", "Revisión solicitada", 0xFFDC2626),
    Derivada("derivada", "Derivada", 0xFFF59E0B),
    EnTriaje("en_triage", "En triaje", 0xFF06B6D4),
    Enviada("enviada", "Enviada al turno", 0xFF8B5CF6),
    EnCurso("en_curso", "En curso", 0xFF2563EB),
    Agendada("agendado", "Agendada", 0xFF64748B),
    Cerrada("cerrado", "Cerrada", 0xFF9CA3AF),
    /** Un valor que la app no conoce: se muestra, al final de los abiertos, sin inventarle sentido. */
    Otro(null, "Otro estado", 0xFF6B7280),
    /** El paciente no tiene consulta en la org activa: el LED va hueco. */
    SinConsulta(null, "Sin consulta", 0xFF9CA3AF),
    ;

    companion object {
        fun de(valor: String?): EstadoFicha {
            if (valor.isNullOrBlank()) return SinConsulta
            return entries.firstOrNull { it.valor == valor } ?: Otro
        }
    }
}
