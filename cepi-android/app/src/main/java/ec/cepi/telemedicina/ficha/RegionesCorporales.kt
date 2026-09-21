package ec.cepi.telemedicina.ficha

/**
 * Una región tocable de las siluetas (§4.6). Posiciones en % de la imagen, idénticas a
 * `BodyMapField.vue`, `ficha.html` y `RegionesCorporales.swift`: si cambian allá, cambian acá.
 */
data class RegionCorporal(
    val clave: String,
    val etiqueta: String,
    val izquierda: Float,
    val arriba: Float,
    val ancho: Float,
    val alto: Float,
) {
    companion object {
        /** 38 regiones: 19 de la vista anterior y 19 de la posterior. */
        val todas = listOf(
        RegionCorporal("cabeza_ant", "Cabeza (frontal)", 19.30f, 2.00f, 9.57f, 12.31f),
        RegionCorporal("cuello_ant", "Cuello anterior", 22.00f, 14.50f, 4.50f, 3.50f),
        RegionCorporal("hombro_der_ant", "Hombro derecho (ant.)", 13.50f, 18.00f, 6.50f, 4.50f),
        RegionCorporal("hombro_izq_ant", "Hombro izquierdo (ant.)", 28.00f, 18.00f, 6.50f, 4.50f),
        RegionCorporal("torax", "Tórax", 16.00f, 22.50f, 16.00f, 13.00f),
        RegionCorporal("abdomen", "Abdomen", 17.00f, 35.50f, 14.00f, 11.00f),
        RegionCorporal("pelvis_ant", "Pelvis / genitales", 19.00f, 46.50f, 10.00f, 6.00f),
        RegionCorporal("brazo_der_ant", "Brazo derecho (ant.)", 9.00f, 22.50f, 6.50f, 14.00f),
        RegionCorporal("brazo_izq_ant", "Brazo izquierdo (ant.)", 32.50f, 22.50f, 6.50f, 14.00f),
        RegionCorporal("antebrazo_der_ant", "Antebrazo derecho (ant.)", 5.50f, 36.50f, 7.00f, 13.00f),
        RegionCorporal("antebrazo_izq_ant", "Antebrazo izquierdo (ant.)", 35.50f, 36.50f, 7.00f, 13.00f),
        RegionCorporal("mano_der", "Mano derecha", 2.15f, 49.50f, 6.65f, 8.50f),
        RegionCorporal("mano_izq", "Mano izquierda", 39.20f, 49.50f, 9.20f, 8.50f),
        RegionCorporal("muslo_der_ant", "Muslo derecho (ant.)", 15.50f, 52.50f, 8.00f, 21.00f),
        RegionCorporal("muslo_izq_ant", "Muslo izquierdo (ant.)", 24.50f, 52.50f, 8.00f, 21.00f),
        RegionCorporal("pierna_der_ant", "Pierna derecha (ant.)", 14.00f, 73.50f, 7.20f, 20.50f),
        RegionCorporal("pierna_izq_ant", "Pierna izquierda (ant.)", 26.80f, 73.50f, 7.20f, 20.50f),
        RegionCorporal("pie_der", "Pie derecho", 11.62f, 94.00f, 7.14f, 6.00f),
        RegionCorporal("pie_izq", "Pie izquierdo", 28.12f, 94.00f, 7.98f, 6.00f),
        RegionCorporal("cabeza_post", "Cabeza (posterior)", 69.85f, 1.56f, 9.57f, 11.44f),
        RegionCorporal("cuello_post", "Cuello posterior", 72.55f, 13.00f, 4.50f, 3.50f),
        RegionCorporal("hombro_izq_post", "Hombro izquierdo (post.)", 64.05f, 17.50f, 6.50f, 4.50f),
        RegionCorporal("hombro_der_post", "Hombro derecho (post.)", 78.55f, 17.50f, 6.50f, 4.50f),
        RegionCorporal("espalda_alta", "Espalda alta", 66.55f, 22.00f, 16.00f, 13.00f),
        RegionCorporal("lumbar", "Espalda baja / lumbar", 67.55f, 35.00f, 14.00f, 11.00f),
        RegionCorporal("gluteos", "Glúteos", 69.55f, 46.00f, 10.00f, 6.50f),
        RegionCorporal("brazo_izq_post", "Brazo izquierdo (post.)", 59.55f, 22.00f, 6.50f, 14.00f),
        RegionCorporal("brazo_der_post", "Brazo derecho (post.)", 83.05f, 22.00f, 6.50f, 14.00f),
        RegionCorporal("antebrazo_izq_post", "Antebrazo izquierdo (post.)", 56.05f, 36.00f, 7.00f, 13.00f),
        RegionCorporal("antebrazo_der_post", "Antebrazo derecho (post.)", 86.05f, 36.00f, 7.00f, 13.00f),
        RegionCorporal("mano_izq_dorso", "Mano izquierda (dorso)", 52.70f, 49.00f, 6.65f, 8.50f),
        RegionCorporal("mano_der_dorso", "Mano derecha (dorso)", 89.32f, 49.00f, 8.77f, 8.50f),
        RegionCorporal("muslo_izq_post", "Muslo izquierdo (post.)", 65.19f, 52.50f, 7.56f, 21.00f),
        RegionCorporal("muslo_der_post", "Muslo derecho (post.)", 75.90f, 52.50f, 8.85f, 21.00f),
        RegionCorporal("pierna_izq_post", "Pierna izquierda (post.)", 64.55f, 73.50f, 7.20f, 20.50f),
        RegionCorporal("pierna_der_post", "Pierna derecha (post.)", 77.35f, 73.50f, 7.20f, 20.50f),
        RegionCorporal("pie_izq_planta", "Pie izquierdo (planta)", 62.60f, 94.00f, 6.30f, 6.00f),
        RegionCorporal("pie_der_planta", "Pie derecho (planta)", 79.10f, 94.00f, 7.14f, 6.00f),
        )

        /** `regiones_afectadas` se guarda como CSV de claves. */
        fun seleccion(csv: String): Set<String> =
            csv.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()

        /**
         * Marca o desmarca una región. El CSV sigue el orden de la tabla, no el de los toques,
         * para que dos fichas con las mismas regiones guarden el mismo texto.
         */
        fun alternar(clave: String, csv: String): String {
            val elegidas = seleccion(csv).toMutableSet()
            if (!elegidas.remove(clave)) elegidas += clave
            return todas.filter { it.clave in elegidas }.joinToString(",") { it.clave }
        }

        fun resumen(csv: String): String {
            val elegidas = seleccion(csv)
            if (elegidas.isEmpty()) return "Toca las zonas con lesiones."
            val etiquetas = todas.filter { it.clave in elegidas }.map { it.etiqueta }
            return "${etiquetas.size} región(es): " + etiquetas.joinToString(", ")
        }
    }
}
