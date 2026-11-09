import Foundation

/// Las reglas de `FichaCompleta.vue`, sin UI, para poder probarlas (PAPER §24.2.1).
enum FichaLogic {
    /// Los grupos de fotos (§4.7, §8) no escriben campos: crean registros `clinical_image` /
    /// `consent` al subir la foto. Desde la ficha no tendrían dónde guardar.
    static let imageGroups: Set<String> = ["g_4_7", "g_8", "g_8_2"]

    /// Campos que no se comparan entre consultas: son de la propia cita (fecha, estado,
    /// médico) o derivados, y marcarlos diría "cambió" de algo que cambia siempre. Misma lista
    /// que la web.
    static let notCompared: Set<String> = [
        "id", "fecha", "medico_id", "patient_id", "estado", "tipo", "created_at", "updated_at",
        "ficha_num", "examinador_nombre", "gravedad_total", "location", "drpro_cita_id", "tipo_cita",
        "ficha_completitud", "ficha_faltantes", "ficha_calculada_at", "ficha_grupos_con_dato",
        "diagnostico_fuente", "drpro_raw", "drpro_raw_hash",
    ]

    // MARK: Progreso y categorías

    /// El % de la barra: grupos con dato sobre el total, redondeado.
    static func percent(complete: Int, total: Int) -> Int {
        guard total > 0 else { return 0 }
        return Int((Double(complete) / Double(total) * 100).rounded())
    }

    static func progressText(complete: Int, total: Int) -> String {
        "\(complete) de \(total) grupos con dato"
    }

    struct Category: Hashable, Identifiable {
        let name: String
        let groups: [FichaGroup]
        /// Los que se ven: todos, o solo los que faltan.
        let visible: [FichaGroup]
        var complete: Int { groups.filter(\.done).count }
        var id: String { name }
    }

    /// Los grupos vienen planos y en orden; la categoría (§) los agrupa como en la web. Con
    /// «Solo lo que falta» se ven los grupos sin dato y desaparecen las categorías completas.
    static func categories(_ groups: [FichaGroup], onlyMissing: Bool) -> [Category] {
        var names: [String] = []
        var byName: [String: [FichaGroup]] = [:]
        for group in groups {
            let name = group.category.isEmpty ? "Otros" : group.category
            if byName[name] == nil { names.append(name) }
            byName[name, default: []].append(group)
        }
        let all = names.map { name in
            let members = byName[name] ?? []
            return Category(name: name, groups: members, visible: onlyMissing ? members.filter { !$0.done } : members)
        }
        return onlyMissing ? all.filter { !$0.visible.isEmpty } : all
    }

    // MARK: Edición

    static func isEditable(_ group: FichaGroup) -> Bool {
        editBlockReason(group) == nil
    }

    /// Por qué el botón de editar sale deshabilitado; `nil` si se puede editar.
    static func editBlockReason(_ group: FichaGroup) -> String? {
        if imageGroups.contains(group.id) { return "Las fotos se suben en Imágenes o en el chat." }
        if group.form == nil { return "Este grupo no tiene formulario." }
        return nil
    }

    static func editTitle(_ group: FichaGroup) -> String {
        group.done ? "Editar" : "Completar"
    }

    /// El formulario que se abre al editar: el del chat, sin «Omitir».
    static func editableForm(_ group: FichaGroup) -> FormularioBot? {
        guard isEditable(group) else { return nil }
        return group.form?.withoutActions()
    }

    static func savedNotice(_ result: FichaGroupSaveResult) -> String {
        guard let completeness = result.completeness else { return "Guardado" }
        return "Guardado · \(Int(completeness.rounded()))% de la ficha"
    }

    // MARK: Lo cargado

    struct Value: Hashable, Identifiable {
        let key: String
        let label: String
        let text: String
        /// Lo que decía la consulta anterior, si difiere. `nil`: sin cambio o no se compara.
        let previous: String?
        var changed: Bool { previous != nil }
        var id: String { key }
    }

    /// Los pares etiqueta/valor que se leen de un grupo: los campos con dato, en orden. Los
    /// encabezados (`heading`) no tienen clave: no son dato.
    static func values(_ group: FichaGroup, previous: [String: JSONValor]? = nil) -> [Value] {
        guard let form = group.form else { return [] }
        return form.campos.compactMap { field in
            guard let key = field.clave, field.tipo != .titulo, let value = form.valores[key], hasValue(value) else {
                return nil
            }
            return Value(
                key: key,
                label: field.etiqueta.isEmpty ? key : field.etiqueta,
                text: displayText(value, field: field),
                previous: change(key: key, current: value, target: group.target, previous: previous)
            )
        }
    }

    /// Vacío o nulo no es dato; `false` sí (es una respuesta: "No").
    static func hasValue(_ value: JSONValor) -> Bool {
        switch value {
        case .nulo: false
        case .texto(let text): !text.isEmpty
        default: true
        }
    }

    /// Cómo se lee un valor guardado: Sí/No, la etiqueta de su opción, una lista separada por
    /// comas. Las fotos son ids de adjuntos que no le dicen nada al médico: se cuentan.
    static func displayText(_ value: JSONValor, field: CampoFormulario) -> String {
        if field.tipo == .imagenes, case .texto(let csv) = value {
            let count = csv.split(separator: ",").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count
            return count == 1 ? "1 imagen" : "\(count) imágenes"
        }
        switch value {
        case .booleano(let flag):
            return flag ? "Sí" : "No"
        case .lista(let items):
            return items.map(itemText).joined(separator: ", ")
        case .objeto:
            return canonical(value)
        case .nulo:
            return ""
        case .texto, .numero:
            if let option = field.opciones.first(where: { LogicaFormulario.coincide(value, con: $0) }) {
                return option.etiqueta
            }
            return value.texto ?? ""
        }
    }

    private static func itemText(_ item: JSONValor) -> String {
        if case .objeto(let object) = item {
            if let label = object["label"]?.texto { return label }
            if let value = object["value"]?.texto { return value }
            return canonical(item)
        }
        if case .booleano(let flag) = item { return flag ? "Sí" : "No" }
        return item.texto ?? canonical(item)
    }

    // MARK: Cambios respecto de la consulta anterior

    /// ¿Difiere de la consulta anterior? Devuelve lo de entonces, como texto. Solo se comparan
    /// los grupos del episodio: los del paciente los comparten todas sus consultas.
    static func change(key: String, current: JSONValor, target: String, previous: [String: JSONValor]?) -> String? {
        guard target == "episode", let previous, !notCompared.contains(key), !key.contains(":") else { return nil }
        let before = previous[key] ?? .nulo
        if normalized(current) == normalized(before) { return nil }
        return previousText(before)
    }

    /// Cuántos campos cambiaron: el mismo conjunto que se pinta, para que el número de arriba
    /// y las marcas de abajo no se contradigan.
    static func changeCount(_ groups: [FichaGroup], previous: [String: JSONValor]?) -> Int {
        guard previous != nil else { return 0 }
        return groups.reduce(0) { total, group in
            total + values(group, previous: previous).filter(\.changed).count
        }
    }

    /// Vacío, falso y ausente son lo mismo al comparar (igual que la web).
    static func normalized(_ value: JSONValor) -> String {
        switch value {
        case .nulo, .booleano(false): ""
        case .texto(let text): text
        case .booleano(true): "true"
        case .numero: value.texto ?? ""
        case .lista, .objeto: canonical(value)
        }
    }

    static func previousText(_ value: JSONValor) -> String {
        switch value {
        case .nulo, .booleano(false): "(vacío)"
        case .texto(let text) where text.isEmpty: "(vacío)"
        case .booleano(true): "Sí"
        case .lista, .objeto: canonical(value)
        default: value.texto ?? ""
        }
    }

    private static func canonical(_ value: JSONValor) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: Navegación entre consultas

    /// La barra de consultas: dónde está, a dónde se puede ir y qué decir debajo. `visits` va
    /// de la más nueva a la más vieja, así que la ANTERIOR es la siguiente del arreglo.
    struct Navigation: Equatable {
        let index: Int?
        let count: Int

        init(visits: [Registro], episode: String?) {
            index = visits.firstIndex { $0.id == episode }
            count = visits.count
        }

        var hasPrevious: Bool { index.map { $0 < count - 1 } ?? false }
        var hasNext: Bool { index.map { $0 > 0 } ?? false }
        var previousIndex: Int? { hasPrevious ? index.map { $0 + 1 } : nil }
        var nextIndex: Int? { hasNext ? index.map { $0 - 1 } : nil }

        var title: String {
            guard let index else { return "Episodio" }
            return "Episodio \(count - index) de \(count)"
        }

        var previousHint: String { hasPrevious ? "Ver el episodio anterior de este paciente" : "Es el primer episodio" }
        var nextHint: String { hasNext ? "Ver el episodio siguiente de este paciente" : "Es el episodio más reciente" }
    }

    /// La línea bajo «Episodio N de M». Nunca vacía: la barra se ve siempre (CLAUDE.md).
    static func navigationNote(
        _ nav: Navigation, loading: Bool, failed: Bool, changes: Int, previousDate: String?
    ) -> String {
        if loading && nav.count == 0 { return "buscando los otros episodios…" }
        if failed && nav.count == 0 { return "no se pudieron listar los otros episodios" }
        if nav.count == 0 { return "sin consultas registradas de este paciente" }
        if nav.count == 1 { return "único episodio registrado de este paciente" }
        if nav.hasPrevious {
            let date = previousDate ?? "s/f"
            if changes > 0 {
                return "\(changes) \(changes == 1 ? "campo cambió" : "campos cambiaron") desde el del \(date)"
            }
            return "sin cambios respecto del \(date)"
        }
        return "es el primer episodio del paciente"
    }

    /// `YYYY-MM-DD` del episodio.
    static func date(of visit: Registro?) -> String? {
        visit?["fecha"].map { String($0.prefix(10)) }
    }

    // MARK: Respuesta del especialista

    struct SpecialistAnswer: Equatable {
        let text: String
        let date: String?
    }

    /// La respuesta a la interconsulta (`recomendacion` del episodio). Se escribe con
    /// «Responder interconsulta»; en la ficha es de solo lectura.
    static func specialistAnswer(_ episode: Registro?) -> SpecialistAnswer? {
        guard let episode, let text = episode["recomendacion"] else { return nil }
        return SpecialistAnswer(text: text, date: episode["recomendacion_at"])
    }
}
