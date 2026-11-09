import Foundation

/// Las reglas de `EvolucionPaciente.vue` (la tabla adaptable de la web), sin UI, para poder
/// probarlas (PAPER §28.1 y §28.3).
enum EvolutionLogic {
    static func summary(_ rows: [FilaEvolucion]) -> String {
        rows.count == 1 ? "1 ficha" : "\(rows.count) fichas"
    }

    /// Una celda de la tarjeta: la etiqueta de su columna, el texto y si está vacía (gris).
    struct Cell: Equatable {
        let label: String
        let text: String
        let empty: Bool
    }

    /// Las cinco primeras columnas de §28.1, con el texto de la web cuando no hay dato.
    /// Observaciones va aparte: se edita en línea.
    static func cells(_ row: FilaEvolucion) -> [Cell] {
        [
            cell("Fecha", row.fecha, empty: "—"),
            cell("Atendió", row.medico, empty: "—", blank: row.medico == nil && row.especialista == nil),
            cell("Diagnóstico clínico", row.diagnostico, empty: "Sin diagnóstico"),
            cell("Diagnóstico histopatológico", row.diagnosticoHistopatologico, empty: "Sin biopsia"),
            cell("Tratamiento", row.tratamiento, empty: "Sin tratamiento"),
        ]
    }

    static func observationsText(_ row: FilaEvolucion) -> String {
        nonEmpty(row.observaciones) ?? "Sin observaciones"
    }

    private static func cell(_ label: String, _ value: String?, empty: String, blank: Bool? = nil) -> Cell {
        let text = nonEmpty(value)
        return Cell(label: label, text: text ?? empty, empty: blank ?? (text == nil))
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }

    // MARK: Observaciones en línea

    /// Por qué el ✏️ de esa fila está deshabilitado: solo se edita una a la vez.
    static func editBlockReason(row: String, editing: String?) -> String? {
        guard let editing, editing != row else { return nil }
        return "Termina primero la otra observación"
    }

    /// Guardar solo con cambios y sin otro guardado en curso.
    static func canSave(draft: String, original: String?, saving: Bool) -> Bool {
        !saving && !isUnchanged(draft: draft, original: original)
    }

    static func isUnchanged(draft: String, original: String?) -> Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines) == (original ?? "")
    }

    static func saveHint(draft: String, original: String?, saving: Bool) -> String {
        if saving { return "Guardando…" }
        if isUnchanged(draft: draft, original: original) { return "No hay cambios que guardar" }
        return "Guardar en la ficha"
    }

    /// Las filas con la observación guardada (recortada; vacía queda en `nil`).
    static func applying(observations draft: String, to episode: String, in rows: [FilaEvolucion]) -> [FilaEvolucion] {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return rows.map { row in
            guard row.episodio == episode else { return row }
            return FilaEvolucion(
                episodio: row.episodio, fecha: row.fecha, estado: row.estado, medico: row.medico,
                especialista: row.especialista, diagnostico: row.diagnostico,
                diagnosticoHistopatologico: row.diagnosticoHistopatologico, tratamiento: row.tratamiento,
                observaciones: text.isEmpty ? nil : text
            )
        }
    }
}
