import Foundation

// MARK: - La ficha editable (GET /api/bot/ficha, `fichaCompleta` en cepi-bot/src/flowV1.ts)

/// La ficha entera de un paciente o una consulta: los grupos en orden, cada uno con su
/// formulario prellenado y si tiene dato (PAPER §24.2.1, `FichaCompleta.vue`).
struct FullFicha: Decodable, Sendable, Hashable {
    let groups: [FichaGroup]
    /// Grupos con dato.
    let complete: Int
    let total: Int
    /// Etiquetas de los grupos sin dato, en orden.
    let missing: [String]

    enum CodingKeys: String, CodingKey {
        case groups = "grupos"
        case complete = "completos"
        case missing = "faltantes"
        case total
    }

    init(groups: [FichaGroup], complete: Int, total: Int, missing: [String] = []) {
        self.groups = groups
        self.complete = complete
        self.total = total
        self.missing = missing
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        groups = try c.decodeIfPresent([FichaGroup].self, forKey: .groups) ?? []
        complete = try c.decodeIfPresent(Int.self, forKey: .complete) ?? 0
        // Como la web: sin `total`, cuenta los grupos que llegaron.
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? groups.count
        missing = try c.decodeIfPresent([String].self, forKey: .missing) ?? []
    }
}

/// Un grupo de la ficha (1.1, 3.8, 4.7…): su categoría (§), si tiene dato, dónde se guarda
/// (`patient` o `episode`) y el mismo formulario que pide el chat, ya con lo cargado.
struct FichaGroup: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let label: String
    let category: String
    let done: Bool
    let target: String
    /// `null` si el bot no tiene formulario para el grupo.
    let form: FormularioBot?

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? id
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? ""
        done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
        target = try c.decodeIfPresent(String.self, forKey: .target) ?? "episode"
        form = try c.decodeIfPresent(FormularioBot.self, forKey: .form)
    }

    enum CodingKeys: String, CodingKey {
        case id, label, category, done, target, form
    }
}

/// `POST /api/bot/ficha/grupo`: guarda UN grupo, por el mismo camino que el chat (coerciones y
/// campos derivados iguales). Es una acción explícita: el bot guarda sin pedir sí/no.
struct FichaGroupSave: Encodable, Sendable, Equatable {
    let groupId: String
    let data: [String: JSONValor]
    let episodeId: String?
    let patientId: String?

    enum CodingKeys: String, CodingKey {
        case groupId = "group_id"
        case episodeId = "episode_id"
        case patientId = "patient_id"
        case data
    }
}

/// Lo que responde el guardado: el % de llenado de la ficha tras guardar, si se pudo calcular.
struct FichaGroupSaveResult: Decodable, Sendable {
    let ok: Bool
    let completeness: Double?

    enum CodingKeys: String, CodingKey {
        case ok
        case completeness = "completitud"
    }
}

extension FormularioBot {
    /// El mismo formulario sin sus acciones. En la ficha no hay conversación que escuche un
    /// «Omitir»: dejarlo sería un botón que no hace nada sin decirlo (`formEditable` de la web).
    func withoutActions() -> FormularioBot {
        FormularioBot(
            id: id, titulo: titulo, campos: campos, textoEnviar: textoEnviar,
            plantillaEnvio: plantillaEnvio, estructurado: estructurado, acciones: [], valores: valores
        )
    }

    init(
        id: String, titulo: String, campos: [CampoFormulario], textoEnviar: String?,
        plantillaEnvio: String?, estructurado: Bool, acciones: [RespuestaRapida], valores: [String: JSONValor]
    ) {
        self.id = id
        self.titulo = titulo
        self.campos = campos
        self.textoEnviar = textoEnviar
        self.plantillaEnvio = plantillaEnvio
        self.estructurado = estructurado
        self.acciones = acciones
        self.valores = valores
    }
}
