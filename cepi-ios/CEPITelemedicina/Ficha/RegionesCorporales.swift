import Foundation

/// Una región tocable de las siluetas (§4.6). Posiciones en % de la imagen, idénticas a
/// `BodyMapField.vue` y `ficha.html`: si cambian allá, cambian acá.
struct RegionCorporal: Identifiable, Sendable, Hashable {
    let clave: String
    let etiqueta: String
    let izquierda: Double
    let arriba: Double
    let ancho: Double
    let alto: Double

    var id: String { clave }

    // 38 regiones: 19 de la vista anterior y 19 de la posterior. (BodyMapField.vue dice 36, pero la tabla tiene 38.)
    static let todas: [RegionCorporal] = [
        .init(clave: "cabeza_ant", etiqueta: "Cabeza (frontal)", izquierda: 19.30, arriba: 2.00, ancho: 9.57, alto: 12.31),
        .init(clave: "cuello_ant", etiqueta: "Cuello anterior", izquierda: 22.00, arriba: 14.50, ancho: 4.50, alto: 3.50),
        .init(clave: "hombro_der_ant", etiqueta: "Hombro derecho (ant.)", izquierda: 13.50, arriba: 18.00, ancho: 6.50, alto: 4.50),
        .init(clave: "hombro_izq_ant", etiqueta: "Hombro izquierdo (ant.)", izquierda: 28.00, arriba: 18.00, ancho: 6.50, alto: 4.50),
        .init(clave: "torax", etiqueta: "Tórax", izquierda: 16.00, arriba: 22.50, ancho: 16.00, alto: 13.00),
        .init(clave: "abdomen", etiqueta: "Abdomen", izquierda: 17.00, arriba: 35.50, ancho: 14.00, alto: 11.00),
        .init(clave: "pelvis_ant", etiqueta: "Pelvis / genitales", izquierda: 19.00, arriba: 46.50, ancho: 10.00, alto: 6.00),
        .init(clave: "brazo_der_ant", etiqueta: "Brazo derecho (ant.)", izquierda: 9.00, arriba: 22.50, ancho: 6.50, alto: 14.00),
        .init(clave: "brazo_izq_ant", etiqueta: "Brazo izquierdo (ant.)", izquierda: 32.50, arriba: 22.50, ancho: 6.50, alto: 14.00),
        .init(clave: "antebrazo_der_ant", etiqueta: "Antebrazo derecho (ant.)", izquierda: 5.50, arriba: 36.50, ancho: 7.00, alto: 13.00),
        .init(clave: "antebrazo_izq_ant", etiqueta: "Antebrazo izquierdo (ant.)", izquierda: 35.50, arriba: 36.50, ancho: 7.00, alto: 13.00),
        .init(clave: "mano_der", etiqueta: "Mano derecha", izquierda: 2.15, arriba: 49.50, ancho: 6.65, alto: 8.50),
        .init(clave: "mano_izq", etiqueta: "Mano izquierda", izquierda: 39.20, arriba: 49.50, ancho: 9.20, alto: 8.50),
        .init(clave: "muslo_der_ant", etiqueta: "Muslo derecho (ant.)", izquierda: 15.50, arriba: 52.50, ancho: 8.00, alto: 21.00),
        .init(clave: "muslo_izq_ant", etiqueta: "Muslo izquierdo (ant.)", izquierda: 24.50, arriba: 52.50, ancho: 8.00, alto: 21.00),
        .init(clave: "pierna_der_ant", etiqueta: "Pierna derecha (ant.)", izquierda: 14.00, arriba: 73.50, ancho: 7.20, alto: 20.50),
        .init(clave: "pierna_izq_ant", etiqueta: "Pierna izquierda (ant.)", izquierda: 26.80, arriba: 73.50, ancho: 7.20, alto: 20.50),
        .init(clave: "pie_der", etiqueta: "Pie derecho", izquierda: 11.62, arriba: 94.00, ancho: 7.14, alto: 6.00),
        .init(clave: "pie_izq", etiqueta: "Pie izquierdo", izquierda: 28.12, arriba: 94.00, ancho: 7.98, alto: 6.00),
        .init(clave: "cabeza_post", etiqueta: "Cabeza (posterior)", izquierda: 69.85, arriba: 1.56, ancho: 9.57, alto: 11.44),
        .init(clave: "cuello_post", etiqueta: "Cuello posterior", izquierda: 72.55, arriba: 13.00, ancho: 4.50, alto: 3.50),
        .init(clave: "hombro_izq_post", etiqueta: "Hombro izquierdo (post.)", izquierda: 64.05, arriba: 17.50, ancho: 6.50, alto: 4.50),
        .init(clave: "hombro_der_post", etiqueta: "Hombro derecho (post.)", izquierda: 78.55, arriba: 17.50, ancho: 6.50, alto: 4.50),
        .init(clave: "espalda_alta", etiqueta: "Espalda alta", izquierda: 66.55, arriba: 22.00, ancho: 16.00, alto: 13.00),
        .init(clave: "lumbar", etiqueta: "Espalda baja / lumbar", izquierda: 67.55, arriba: 35.00, ancho: 14.00, alto: 11.00),
        .init(clave: "gluteos", etiqueta: "Glúteos", izquierda: 69.55, arriba: 46.00, ancho: 10.00, alto: 6.50),
        .init(clave: "brazo_izq_post", etiqueta: "Brazo izquierdo (post.)", izquierda: 59.55, arriba: 22.00, ancho: 6.50, alto: 14.00),
        .init(clave: "brazo_der_post", etiqueta: "Brazo derecho (post.)", izquierda: 83.05, arriba: 22.00, ancho: 6.50, alto: 14.00),
        .init(clave: "antebrazo_izq_post", etiqueta: "Antebrazo izquierdo (post.)", izquierda: 56.05, arriba: 36.00, ancho: 7.00, alto: 13.00),
        .init(clave: "antebrazo_der_post", etiqueta: "Antebrazo derecho (post.)", izquierda: 86.05, arriba: 36.00, ancho: 7.00, alto: 13.00),
        .init(clave: "mano_izq_dorso", etiqueta: "Mano izquierda (dorso)", izquierda: 52.70, arriba: 49.00, ancho: 6.65, alto: 8.50),
        .init(clave: "mano_der_dorso", etiqueta: "Mano derecha (dorso)", izquierda: 89.32, arriba: 49.00, ancho: 8.77, alto: 8.50),
        .init(clave: "muslo_izq_post", etiqueta: "Muslo izquierdo (post.)", izquierda: 65.19, arriba: 52.50, ancho: 7.56, alto: 21.00),
        .init(clave: "muslo_der_post", etiqueta: "Muslo derecho (post.)", izquierda: 75.90, arriba: 52.50, ancho: 8.85, alto: 21.00),
        .init(clave: "pierna_izq_post", etiqueta: "Pierna izquierda (post.)", izquierda: 64.55, arriba: 73.50, ancho: 7.20, alto: 20.50),
        .init(clave: "pierna_der_post", etiqueta: "Pierna derecha (post.)", izquierda: 77.35, arriba: 73.50, ancho: 7.20, alto: 20.50),
        .init(clave: "pie_izq_planta", etiqueta: "Pie izquierdo (planta)", izquierda: 62.60, arriba: 94.00, ancho: 6.30, alto: 6.00),
        .init(clave: "pie_der_planta", etiqueta: "Pie derecho (planta)", izquierda: 79.10, arriba: 94.00, ancho: 7.14, alto: 6.00),
    ]

    /// `regiones_afectadas` se guarda como CSV de claves.
    static func seleccion(_ csv: String) -> Set<String> {
        Set(csv.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    }

    /// Marca o desmarca una región. El CSV sigue el orden de la tabla, no el de los toques,
    /// para que dos fichas con las mismas regiones guarden el mismo texto.
    static func alternar(_ clave: String, en csv: String) -> String {
        var elegidas = seleccion(csv)
        if elegidas.contains(clave) { elegidas.remove(clave) } else { elegidas.insert(clave) }
        return todas.filter { elegidas.contains($0.clave) }.map(\.clave).joined(separator: ",")
    }

    static func resumen(_ csv: String) -> String {
        let elegidas = seleccion(csv)
        guard !elegidas.isEmpty else { return "Toca las zonas con lesiones." }
        let etiquetas = todas.filter { elegidas.contains($0.clave) }.map(\.etiqueta)
        return "\(etiquetas.count) región(es): " + etiquetas.joined(separator: ", ")
    }
}
