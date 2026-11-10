package ec.cepi.telemedicina.pacientes

/** Celular y email del paciente (PAPER §36.1). Misma regla que cepi-bot/src/contacto.ts. */
object Contacto {
    const val MOBILE_HINT = "Celular de 10 dígitos que empiece con 09 (o con + y el código del país)."

    private val FORMATO = Regex("^[+\\d][\\d\\s().-]*$")
    private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")

    /**
     * Celular de Ecuador `09XXXXXXXX` o internacional con `+` y 8 a 15 dígitos. Acepta espacios,
     * guiones y paréntesis. Devuelve el número limpio o null.
     */
    fun normalizeMobile(raw: String): String? {
        val s = raw.trim()
        if (!FORMATO.matches(s)) return null
        val digits = s.filter { it.isDigit() }
        if (s.startsWith("+")) {
            if (digits.startsWith("593")) {
                return if (digits.length == 12 && digits[3] == '9') "0" + digits.drop(3) else null
            }
            return if (digits.length in 8..15) "+$digits" else null
        }
        return when {
            digits.length == 10 && digits.startsWith("09") -> digits
            digits.length == 12 && digits.startsWith("5939") -> "0" + digits.drop(3)
            digits.length == 9 && digits.startsWith("9") -> "0$digits"
            else -> null
        }
    }

    fun isValidEmail(raw: String): Boolean = EMAIL.matches(raw.trim())

    /** Por qué «Crear» está gris, o null si se puede crear. */
    fun blocker(nombre: String, apellidos: String, cedula: String, celular: String, email: String): String? = when {
        listOf(nombre, apellidos, cedula, celular).any { it.isBlank() } ->
            "Nombre, apellidos, cédula y celular son obligatorios."
        normalizeMobile(celular) == null -> "Celular no válido. $MOBILE_HINT"
        email.isNotBlank() && !isValidEmail(email) -> "Email no válido (o déjalo vacío)."
        else -> null
    }
}
