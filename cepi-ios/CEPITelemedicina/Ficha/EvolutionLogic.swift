import Foundation

/// Las reglas de `EvolucionPaciente.vue` (la sección Evolución de la web), sin UI, para poder
/// probarlas (PAPER §28.1, §28.3 y §28.4: una ficha, varias evoluciones).
enum EvolutionLogic {
    // MARK: Fichas y sus evoluciones

    /// Una ficha (episodio) con sus evoluciones. `rows` va como lo manda el servidor, de la más
    /// nueva a la más vieja; la pantalla las muestra en orden de cita (`chronological`).
    struct EpisodeGroup: Equatable, Identifiable {
        let episodeId: String
        let rows: [FilaEvolucion]

        var id: String { episodeId }

        /// En orden de cita (PAPER §28.4.1): la más vieja arriba y la más nueva abajo, justo
        /// encima del bloque «Próximo control», como se lee una historia clínica.
        var chronological: [FilaEvolucion] { rows.reversed() }

        /// La vigente: la más nueva. Es la que resalta la tarjeta y la del próximo control.
        var latest: FilaEvolucion? { rows.first }

        /// Motivo de consulta de la ficha: viene en cada fila; vale el primero con texto.
        var motivo: String? { rows.lazy.compactMap { EvolutionLogic.nonEmpty($0.motivo) }.first }

        var estado: String? { rows.lazy.compactMap { EvolutionLogic.nonEmpty($0.estado) }.first }

        /// La fecha en que se abrió la ficha: la de la primera cita (la inicial o, si no está
        /// marcada, la más vieja; en la ficha sin evoluciones, la de la fila armada).
        var openedOn: String? {
            if let initial = rows.first(where: \.esInicial) { return EvolutionLogic.nonEmpty(initial.fecha) }
            return rows.reversed().lazy.compactMap { EvolutionLogic.nonEmpty($0.fecha) }.first
        }

        var isDischarged: Bool { estado == "alta" }

        /// Cuántas citas tiene: la fila armada también es una (la ficha misma).
        var count: Int { rows.count }
    }

    /// Agrupa por ficha respetando el orden del servidor (fichas de la más nueva a la más vieja).
    static func groups(_ rows: [FilaEvolucion]) -> [EpisodeGroup] {
        var order: [String] = []
        var byEpisode: [String: [FilaEvolucion]] = [:]
        for row in rows {
            if byEpisode[row.episodio] == nil { order.append(row.episodio) }
            byEpisode[row.episodio, default: []].append(row)
        }
        return order.map { EpisodeGroup(episodeId: $0, rows: byEpisode[$0] ?? []) }
    }

    /// La ficha abierta: la de la barra de episodios; si no está entre las del paciente, la más
    /// nueva.
    static func openGroup(_ groups: [EpisodeGroup], current: String?) -> EpisodeGroup? {
        groups.first { $0.episodeId == current } ?? groups.first
    }

    /// Las evoluciones de la ficha abierta.
    static func openRows(_ rows: [FilaEvolucion], current: String?) -> [FilaEvolucion] {
        openGroup(groups(rows), current: current)?.rows ?? []
    }

    static func countText(_ count: Int) -> String {
        count == 1 ? "1 evolución" : "\(count) evoluciones"
    }

    static func summary(_ groups: [EpisodeGroup]) -> String {
        groups.count == 1 ? "1 ficha" : "\(groups.count) fichas"
    }

    static func statusLabel(_ estado: String?) -> String {
        guard let estado = nonEmpty(estado) else { return "Sin estado" }
        let known = EstadoFicha(estado)
        return known == .otro ? estado : known.etiqueta
    }

    /// Cabecera de la ficha abierta: motivo, fecha de apertura y estado.
    static func headerTitle(_ group: EpisodeGroup) -> String {
        group.motivo ?? "Sin motivo de consulta registrado"
    }

    static func headerDetail(_ group: EpisodeGroup) -> String {
        "Abierta el \(group.openedOn ?? "—") · \(statusLabel(group.estado)) · \(countText(group.count))"
    }

    /// Etiqueta de la primera cita: la foto guardada al agregar la primera evolución, o la ficha
    /// misma mientras no tenga evoluciones registradas.
    static func rowBadge(_ row: FilaEvolucion) -> String? {
        if row.isAssembled { return "Primera cita · datos de la ficha" }
        if row.esInicial { return "Primera cita" }
        return nil
    }

    // MARK: Agregar evolución

    /// Por qué «＋ Agregar evolución» está deshabilitado, o `nil` si se puede. Nunca se esconde.
    static func addBlockReason(group: EpisodeGroup?, loading: Bool = false) -> String? {
        guard let group else {
            return loading ? "Cargando la evolución…" : "Este paciente todavía no tiene fichas: abre una consulta nueva"
        }
        if group.isDischarged { return "Esta ficha está de alta: abre una consulta nueva" }
        return nil
    }

    /// Por qué no se puede guardar el formulario, o `nil` si se puede.
    static func submitBlockReason(_ evolution: EvolutionCreate, saving: Bool) -> String? {
        if saving { return "Guardando…" }
        if !evolution.hasContent { return "Escribe al menos hallazgos, diagnóstico, tratamiento u observaciones" }
        return nil
    }

    // MARK: Celdas

    /// Una celda de la tarjeta: la etiqueta de su columna, el texto y si está vacía (gris).
    struct Cell: Equatable {
        let label: String
        let text: String
        let empty: Bool
    }

    /// Las columnas de §28.1 más hallazgos y próximo control de §28.4, con el texto de la web
    /// cuando no hay dato. Observaciones va aparte: se edita en línea.
    static func cells(_ row: FilaEvolucion) -> [Cell] {
        [
            cell("Fecha", row.fecha, empty: "—"),
            cell("Atendió", row.medico, empty: "—", blank: row.medico == nil && row.especialista == nil),
            cell("Hallazgos", row.hallazgos, empty: "Sin hallazgos"),
            cell("Diagnóstico clínico", row.diagnostico, empty: "Sin diagnóstico"),
            cell("Diagnóstico histopatológico", row.diagnosticoHistopatologico, empty: "Sin biopsia"),
            cell("Tratamiento", row.tratamiento, empty: "Sin tratamiento"),
            cell("Próximo control", nextControl(row), empty: "Sin próximo control"),
        ]
    }

    static func nextControl(_ row: FilaEvolucion) -> String? {
        let parts = [nonEmpty(row.proximoControlFecha), nonEmpty(row.proximoControlMotivo)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " — ")
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

    // MARK: Próximo control al pie (PAPER §28.4)

    /// El bloque «Próximo control» al pie de la ficha abierta, con lo de su evolución más nueva.
    enum NextControl: Equatable {
        /// Ficha de alta: no quedan controles pendientes.
        case discharged
        /// La evolución más nueva no indica fecha de control.
        case none
        case scheduled(date: String, reason: String?, status: ControlStatus)

        var text: String {
            switch self {
            case .discharged: "Ficha de alta: sin controles pendientes"
            case .none: "Sin próximo control indicado"
            case let .scheduled(date, reason, _):
                [date, reason].compactMap { $0 }.joined(separator: " — ")
            }
        }

        var statusLabel: String? {
            guard case let .scheduled(_, _, status) = self else { return nil }
            switch status {
            case .overdue: return "Atrasado"
            case .today: return "Hoy"
            case .upcoming: return "Próximo"
            }
        }
    }

    /// `today` es la fecha local `YYYY-MM-DD`; las fechas se comparan como texto.
    static func nextControl(_ group: EpisodeGroup, today: String) -> NextControl {
        if group.isDischarged { return .discharged }
        guard let latest = group.latest, let date = nonEmpty(latest.proximoControlFecha) else { return .none }
        let day = String(date.prefix(10))
        let status: ControlStatus = day < today ? .overdue : (day == today ? .today : .upcoming)
        return .scheduled(date: day, reason: nonEmpty(latest.proximoControlMotivo), status: status)
    }

    /// Hoy en la zona horaria del teléfono, `YYYY-MM-DD`.
    static func localToday(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    // MARK: Editar una evolución (PAPER §28.4.1)

    /// Por qué el bloque «Próximo control» no abre el formulario, o `nil` si se puede tocar.
    /// Nunca se esconde: con la ficha de alta queda a la vista y lo dice.
    static func nextControlTapBlockReason(_ group: EpisodeGroup) -> String? {
        if group.isDischarged { return dischargedNextControlReason }
        if group.latest == nil { return "Esta ficha todavía no tiene evoluciones" }
        return nil
    }

    static let dischargedNextControlReason = "Ficha de alta: abre una consulta nueva para otro control"

    /// Lo que se escribe en el formulario de una evolución. Las fechas van como `YYYY-MM-DD`.
    struct EvolutionDraft: Equatable {
        var date: String
        var findings: String
        var diagnosis: String
        var treatment: String
        var observations: String
        var hasNextControl: Bool
        var nextControlDate: String
        var nextControlReason: String

        /// Prellenado con la fila. Sin fecha (fila armada sin fecha) queda `today`; sin próximo
        /// control, la fecha sugerida es `suggestedNextControl`, apagada.
        init(row: FilaEvolucion, today: String, suggestedNextControl: String) {
            date = EvolutionLogic.day(row.fecha) ?? today
            findings = row.hallazgos ?? ""
            diagnosis = row.diagnostico ?? ""
            treatment = row.tratamiento ?? ""
            observations = row.observaciones ?? ""
            let control = EvolutionLogic.day(row.proximoControlFecha)
            hasNextControl = control != nil
            nextControlDate = control ?? suggestedNextControl
            nextControlReason = row.proximoControlMotivo ?? ""
        }
    }

    /// El cuerpo de `POST /api/bot/evolucion/editar` con solo lo que cambió respecto de la fila.
    /// Un texto borrado viaja vacío (el bot lo borra); apagar el próximo control borra su fecha
    /// y su motivo. La fecha de la cita nunca viaja vacía.
    static func edit(_ row: FilaEvolucion, draft: EvolutionDraft) -> EvolutionEdit {
        var edit = EvolutionEdit(row: row)
        func changed(_ value: String, _ original: String?) -> String? {
            let new = value.trimmingCharacters(in: .whitespacesAndNewlines)
            let old = (original ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return new == old ? nil : new
        }
        let date = draft.date.trimmingCharacters(in: .whitespaces)
        if !date.isEmpty, date != day(row.fecha) { edit.fecha = date }
        edit.hallazgos = changed(draft.findings, row.hallazgos)
        edit.diagnostico = changed(draft.diagnosis, row.diagnostico)
        edit.tratamiento = changed(draft.treatment, row.tratamiento)
        edit.observaciones = changed(draft.observations, row.observaciones)
        edit.proximoControlFecha = changed(draft.hasNextControl ? draft.nextControlDate : "", day(row.proximoControlFecha))
        edit.proximoControlMotivo = changed(draft.hasNextControl ? draft.nextControlReason : "", row.proximoControlMotivo)
        return edit
    }

    /// Por qué no se puede guardar el formulario en modo edición, o `nil` si se puede.
    static func editSubmitBlockReason(_ edit: EvolutionEdit, saving: Bool) -> String? {
        if saving { return "Guardando…" }
        if edit.isEmpty { return "No hay cambios que guardar" }
        return nil
    }

    /// `YYYY-MM-DD` de una fecha que puede venir con hora; `nil` si no hay.
    static func day(_ value: String?) -> String? {
        nonEmpty(value).map { String($0.prefix(10)) }
    }

    // MARK: Observaciones en línea

    /// Dónde guarda el ✏️ de una fila: la evolución registrada, o la sección 7 de la ficha si es
    /// la fila armada (PAPER §28.4).
    enum ObservationsTarget: Equatable {
        case evolution(String)
        case fichaGroup7(episode: String)
    }

    static func observationsTarget(_ row: FilaEvolucion) -> ObservationsTarget {
        if let id = row.evolutionId { return .evolution(id) }
        return .fichaGroup7(episode: row.episodio)
    }

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

    /// Las filas con la observación guardada en la fila `rowId` (recortada; vacía queda en `nil`).
    static func applying(observations draft: String, to rowId: String, in rows: [FilaEvolucion]) -> [FilaEvolucion] {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return rows.map { row in
            row.id == rowId ? row.with(observations: text.isEmpty ? nil : text) : row
        }
    }
}
