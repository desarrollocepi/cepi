import Foundation

// MARK: - Formularios que manda el bot (BotForm en cepi-bot/src/flowV1.ts)

/// Un formulario que el bot pide pintar en el hilo. La ficha llega así, grupo por grupo
/// (`ficha_grp_g_4_6`…), y la app no conoce los grupos: solo los tipos de campo (PAPER §24.3).
struct FormularioBot: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let titulo: String
    let campos: [CampoFormulario]
    let textoEnviar: String?
    /// Plantilla del mensaje al enviar (`{clave}`), para los formularios que no son estructurados.
    let plantillaEnvio: String?
    /// `submit_mode: 'structured'`: se envía `{form_id, data}` en vez de un mensaje.
    let estructurado: Bool
    /// Botones secundarios ("Omitir"): envían su `send` como mensaje.
    let acciones: [RespuestaRapida]
    /// Valores ya guardados, para abrir el grupo prellenado.
    let valores: [String: JSONValor]

    enum CodingKeys: String, CodingKey {
        case id, title, fields, actions, values
        case textoEnviar = "submit_label"
        case plantillaEnvio = "submit_send"
        case modo = "submit_mode"
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        titulo = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        campos = try c.decodeIfPresent([CampoFormulario].self, forKey: .fields) ?? []
        textoEnviar = try c.decodeIfPresent(String.self, forKey: .textoEnviar)
        plantillaEnvio = try c.decodeIfPresent(String.self, forKey: .plantillaEnvio)
        estructurado = try c.decodeIfPresent(String.self, forKey: .modo) == "structured"
        acciones = try c.decodeIfPresent([RespuestaRapida].self, forKey: .actions) ?? []
        valores = try c.decodeIfPresent([String: JSONValor].self, forKey: .values) ?? [:]
    }
}

/// Los tipos que conoce `BotForm.vue`. Uno desconocido se pinta como texto, igual que en la web.
enum TipoCampo: String, Sendable {
    case texto = "text"
    case areaTexto = "textarea"
    case fecha = "date"
    case casilla = "checkbox"
    case opciones = "radio"
    case titulo = "heading"
    case busquedaEntidad = "entity_search"
    case busquedaCIE = "icd_search"
    case mapaCorporal = "body_map"
    case imagenes = "image_upload"
}

struct CampoFormulario: Decodable, Sendable, Hashable {
    let clave: String?
    let etiqueta: String
    let tipoOriginal: String?
    let placeholder: String?
    let requerido: Bool
    let multiple: Bool
    let opciones: [OpcionCampo]
    // Solo entity_search:
    let definicion: String?
    let minimoCaracteres: Int
    let tamanoPagina: Int
    let plantillaSeleccion: String?
    let etiquetaResultado: [String]
    let subResultado: String?

    var tipo: TipoCampo { tipoOriginal.flatMap(TipoCampo.init(rawValue:)) ?? .texto }

    enum CodingKeys: String, CodingKey {
        case key, label, type, placeholder, required, multiple, options
        case definicion = "entity_id"
        case minimoCaracteres = "min_chars"
        case tamanoPagina = "page_size"
        case plantillaSeleccion = "on_select_send"
        case etiquetaResultado = "result_label"
        case subResultado = "result_sub"
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clave = try c.decodeIfPresent(String.self, forKey: .key)
        etiqueta = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        tipoOriginal = try c.decodeIfPresent(String.self, forKey: .type)
        placeholder = try c.decodeIfPresent(String.self, forKey: .placeholder)
        requerido = try c.decodeIfPresent(Bool.self, forKey: .required) ?? false
        multiple = try c.decodeIfPresent(Bool.self, forKey: .multiple) ?? false
        opciones = try c.decodeIfPresent([OpcionCampo].self, forKey: .options) ?? []
        definicion = try c.decodeIfPresent(String.self, forKey: .definicion)
        minimoCaracteres = try c.decodeIfPresent(Int.self, forKey: .minimoCaracteres) ?? 3
        tamanoPagina = try c.decodeIfPresent(Int.self, forKey: .tamanoPagina) ?? 20
        plantillaSeleccion = try c.decodeIfPresent(String.self, forKey: .plantillaSeleccion)
        etiquetaResultado = try c.decodeIfPresent([String].self, forKey: .etiquetaResultado) ?? ["title"]
        subResultado = try c.decodeIfPresent(String.self, forKey: .subResultado)
    }
}

/// Una opción de `radio`: el bot manda `"mestiza"` o `{label: "Sí", value: true}`.
struct OpcionCampo: Decodable, Sendable, Hashable {
    let etiqueta: String
    let valor: JSONValor

    enum CodingKeys: String, CodingKey { case label, value }

    init(from decoder: any Decoder) throws {
        if let texto = try? decoder.singleValueContainer().decode(String.self) {
            etiqueta = texto
            valor = .texto(texto)
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        valor = try c.decode(JSONValor.self, forKey: .value)
        etiqueta = try c.decodeIfPresent(String.self, forKey: .label) ?? valor.texto ?? ""
    }
}

/// Una sección de la ficha y si ya tiene dato (el menú "Secciones").
struct Marcador: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let etiqueta: String
    let categoria: String
    let hecho: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case etiqueta = "label"
        case categoria = "category"
        case hecho = "done"
    }

    /// En el orden en que llegan: la ficha ya viene ordenada y la categoría cambia por tramos.
    static func porCategoria(_ marcadores: [Marcador]) -> [(categoria: String, marcadores: [Marcador])] {
        var grupos: [(categoria: String, marcadores: [Marcador])] = []
        for marcador in marcadores {
            if grupos.last?.categoria == marcador.categoria {
                grupos[grupos.count - 1].marcadores.append(marcador)
            } else {
                grupos.append((marcador.categoria, [marcador]))
            }
        }
        return grupos
    }
}

// MARK: - Derivar

/// Un círculo, especialidad o turno de `GET /api/groups`.
struct GrupoDerivacion: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let slug: String
    let nombre: String
    /// `specialty` | `circle` | `roster` (turno) | `all` (toda la red)
    let tipo: String?
    let miembros: Int

    enum CodingKeys: String, CodingKey {
        case id, slug
        case nombre = "name"
        case tipo = "kind"
        case miembros = "member_count"
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = try c.decode(String.self, forKey: .slug)
        nombre = try c.decodeIfPresent(String.self, forKey: .nombre) ?? slug
        tipo = try c.decodeIfPresent(String.self, forKey: .tipo)
        miembros = try c.decodeIfPresent(Int.self, forKey: .miembros) ?? 0
    }
}

/// A quién está derivado un episodio ahora (`GET /api/review-queue/entity/:id`): una
/// revisión pendiente por persona. Con varias derivaciones a la vez, son varias.
struct Derivado: Decodable, Sendable, Hashable, Identifiable {
    let usuario: String
    let nombre: String?
    let email: String?

    var id: String { usuario }
    var comoSeLlama: String { nombre ?? email ?? "Profesional" }

    enum CodingKeys: String, CodingKey {
        case usuario = "user_id"
        case nombre = "name"
        case email
    }
}

struct Derivaciones: Decodable, Sendable {
    let derivados: [Derivado]
}

struct MiembroGrupo: Decodable, Sendable, Hashable, Identifiable {
    let usuario: String
    let nombre: String?
    let email: String?
    let rol: String?

    var id: String { usuario }

    enum CodingKeys: String, CodingKey {
        case usuario = "user_id"
        case nombre = "name"
        case email
        case rol = "role_in_group"
    }
}

// MARK: - CIE-10

struct ResultadoCIE: Decodable, Sendable, Hashable {
    let code: String?
    let title: String
}

struct BusquedaCIE: Decodable, Sendable {
    let results: [ResultadoCIE]
}

// MARK: Ficha de evolución (PAPER §28)

/// Una fila de `GET /api/patient-evolution`: una evolución (cita) de una ficha del paciente
/// (PAPER §28.4). Una ficha sin evoluciones registradas da una sola fila armada con los campos
/// del episodio (`evolution_id = nil`). El médico ya viene como nombre y cada campo ya cayó al
/// que tenga dato según la fuente de la ficha (CEPI o espejo DrPro): la app solo lo pinta.
///
/// Los campos de §28.4 son opcionales: un backend anterior manda solo una fila por ficha con
/// las seis columnas de §28.1, y se lee como la fila armada de cada ficha.
struct FilaEvolucion: Decodable, Sendable, Hashable, Identifiable {
    let episodio: String
    /// `YYYY-MM-DD`, como texto: no se convierte a fecha para no correrla de día.
    let fecha: String?
    /// Estado de la ficha (episodio), no de la cita.
    let estado: String?
    let medico: String?
    /// El especialista que respondió la derivación, si la hubo (va en la fila inicial).
    let especialista: String?
    let diagnostico: String?
    let diagnosticoHistopatologico: String?
    let tratamiento: String?
    let observaciones: String?
    /// La evolución registrada; `nil` en la fila armada de una ficha sin evoluciones.
    let evolutionId: String?
    /// Motivo de consulta de la ficha.
    let motivo: String?
    /// La foto de la primera cita, guardada al agregar la primera evolución.
    let esInicial: Bool
    let hallazgos: String?
    let proximoControlFecha: String?
    let proximoControlMotivo: String?

    /// Única aunque una ficha tenga varias filas: la armada es la única de su ficha.
    var id: String { evolutionId ?? "episode:\(episodio)" }

    /// Sin `evolution_id`: la primera cita sale de los campos del episodio y sus observaciones se
    /// guardan en la sección 7 de la ficha (`g_7`).
    var isAssembled: Bool { evolutionId == nil }

    init(
        episodio: String, fecha: String?, estado: String?, medico: String?, especialista: String?,
        diagnostico: String?, diagnosticoHistopatologico: String?, tratamiento: String?, observaciones: String?,
        evolutionId: String? = nil, motivo: String? = nil, esInicial: Bool = false, hallazgos: String? = nil,
        proximoControlFecha: String? = nil, proximoControlMotivo: String? = nil
    ) {
        self.episodio = episodio
        self.fecha = fecha
        self.estado = estado
        self.medico = medico
        self.especialista = especialista
        self.diagnostico = diagnostico
        self.diagnosticoHistopatologico = diagnosticoHistopatologico
        self.tratamiento = tratamiento
        self.observaciones = observaciones
        self.evolutionId = evolutionId
        self.motivo = motivo
        self.esInicial = esInicial
        self.hallazgos = hallazgos
        self.proximoControlFecha = proximoControlFecha
        self.proximoControlMotivo = proximoControlMotivo
    }

    /// La misma fila con otras observaciones (recortadas; vacías quedan en `nil`).
    func with(observations text: String?) -> FilaEvolucion {
        FilaEvolucion(
            episodio: episodio, fecha: fecha, estado: estado, medico: medico, especialista: especialista,
            diagnostico: diagnostico, diagnosticoHistopatologico: diagnosticoHistopatologico,
            tratamiento: tratamiento, observaciones: text, evolutionId: evolutionId, motivo: motivo,
            esInicial: esInicial, hallazgos: hallazgos, proximoControlFecha: proximoControlFecha,
            proximoControlMotivo: proximoControlMotivo
        )
    }

    enum CodingKeys: String, CodingKey {
        case episodio = "episode_id"
        case diagnosticoHistopatologico = "diagnostico_histopatologico"
        /// §28.4 lo nombra `histopatologico`; el backend de §28.1 manda `diagnostico_histopatologico`.
        case histopatologico
        case evolutionId = "evolution_id"
        case esInicial = "es_inicial"
        case proximoControlFecha = "proximo_control_fecha"
        case proximoControlMotivo = "proximo_control_motivo"
        case fecha, estado, medico, especialista, diagnostico, tratamiento, observaciones, motivo, hallazgos
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        episodio = try c.decode(String.self, forKey: .episodio)
        fecha = try c.decodeIfPresent(String.self, forKey: .fecha)
        estado = try c.decodeIfPresent(String.self, forKey: .estado)
        medico = try c.decodeIfPresent(String.self, forKey: .medico)
        especialista = try c.decodeIfPresent(String.self, forKey: .especialista)
        diagnostico = try c.decodeIfPresent(String.self, forKey: .diagnostico)
        diagnosticoHistopatologico = try c.decodeIfPresent(String.self, forKey: .diagnosticoHistopatologico)
            ?? c.decodeIfPresent(String.self, forKey: .histopatologico)
        tratamiento = try c.decodeIfPresent(String.self, forKey: .tratamiento)
        observaciones = try c.decodeIfPresent(String.self, forKey: .observaciones)
        evolutionId = try c.decodeIfPresent(String.self, forKey: .evolutionId)
        motivo = try c.decodeIfPresent(String.self, forKey: .motivo)
        esInicial = try c.decodeIfPresent(Bool.self, forKey: .esInicial) ?? false
        hallazgos = try c.decodeIfPresent(String.self, forKey: .hallazgos)
        proximoControlFecha = try c.decodeIfPresent(String.self, forKey: .proximoControlFecha)
        proximoControlMotivo = try c.decodeIfPresent(String.self, forKey: .proximoControlMotivo)
    }
}

/// `POST /api/bot/episodio/evolucion` (PAPER §28.4): una evolución nueva en la ficha. Acción
/// explícita: el bot guarda sin pedir sí/no. Lo vacío no viaja, porque la cabecera de la ficha
/// se actualiza solo con lo que trae la evolución.
struct EvolutionCreate: Encodable, Sendable, Equatable {
    let episodeId: String
    let fecha: String?
    let hallazgos: String?
    let diagnostico: String?
    let tratamiento: String?
    let observaciones: String?
    let proximoControlFecha: String?
    let proximoControlMotivo: String?

    init(
        episodeId: String, fecha: String?, hallazgos: String = "", diagnostico: String = "",
        tratamiento: String = "", observaciones: String = "", proximoControlFecha: String? = nil,
        proximoControlMotivo: String = ""
    ) {
        func clean(_ text: String?) -> String? {
            guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            return text
        }
        self.episodeId = episodeId
        self.fecha = clean(fecha)
        self.hallazgos = clean(hallazgos)
        self.diagnostico = clean(diagnostico)
        self.tratamiento = clean(tratamiento)
        self.observaciones = clean(observaciones)
        self.proximoControlFecha = clean(proximoControlFecha)
        self.proximoControlMotivo = clean(proximoControlMotivo)
    }

    /// El bot pide al menos uno de estos cuatro (si no, 400).
    var hasContent: Bool { [hallazgos, diagnostico, tratamiento, observaciones].contains { $0 != nil } }

    enum CodingKeys: String, CodingKey {
        case episodeId = "episode_id"
        case proximoControlFecha = "proximo_control_fecha"
        case proximoControlMotivo = "proximo_control_motivo"
        case fecha, hallazgos, diagnostico, tratamiento, observaciones
    }
}

/// Respuesta `201 {ok, evolution_id}` de `POST /api/bot/episodio/evolucion`.
struct EvolutionCreateResult: Decodable, Sendable {
    let ok: Bool
    let evolutionId: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case evolutionId = "evolution_id"
    }
}

/// `POST /api/bot/evolucion/editar` (PAPER §28.4.1): el formulario de una evolución o el ✏️ de
/// sus observaciones. Viaja solo lo que cambió: lo que no viene no se toca, y un texto vacío
/// borra el campo (la `fecha` nunca va vacía). Con `episodeId` es la fila armada de una ficha
/// sin evoluciones: el bot registra su evolución inicial y edita esa.
struct EvolutionEdit: Encodable, Sendable, Equatable {
    let evolutionId: String?
    let episodeId: String?
    var fecha: String?
    var hallazgos: String?
    var diagnostico: String?
    var tratamiento: String?
    var observaciones: String?
    var proximoControlFecha: String?
    var proximoControlMotivo: String?

    /// El ✏️ de observaciones en una evolución registrada.
    init(evolutionId: String, observaciones: String) {
        self.evolutionId = evolutionId
        episodeId = nil
        self.observaciones = observaciones
    }

    /// La evolución registrada (`evolution_id`) o, en la fila armada, su ficha (`episode_id`).
    init(row: FilaEvolucion) {
        evolutionId = row.evolutionId
        episodeId = row.evolutionId == nil ? row.episodio : nil
    }

    /// Sin ningún campo el bot responde 400 («No hay nada que guardar»).
    var isEmpty: Bool {
        [fecha, hallazgos, diagnostico, tratamiento, observaciones, proximoControlFecha, proximoControlMotivo]
            .allSatisfy { $0 == nil }
    }

    enum CodingKeys: String, CodingKey {
        case evolutionId = "evolution_id"
        case episodeId = "episode_id"
        case proximoControlFecha = "proximo_control_fecha"
        case proximoControlMotivo = "proximo_control_motivo"
        case fecha, hallazgos, diagnostico, tratamiento, observaciones
    }
}

/// `POST /api/bot/ficha/grupo` con las observaciones de una ficha (grupo `g_7`), desde la
/// sección Evolución. Es una acción explícita del usuario: el bot guarda sin pedir sí/no.
struct ObservationsSave: Encodable, Sendable {
    let groupId: String
    let data: [String: String]
    let episodeId: String
    let patientId: String

    init(episodio: String, paciente: String, texto: String) {
        groupId = "g_7"
        data = ["observaciones": texto]
        episodeId = episodio
        patientId = paciente
    }

    enum CodingKeys: String, CodingKey {
        case groupId = "group_id"
        case episodeId = "episode_id"
        case patientId = "patient_id"
        case data
    }
}

// MARK: Responder interconsulta (PAPER §30)

/// `POST /api/bot/interconsulta/responder`. Un campo vacío no borra lo que la ficha tenía.
struct InterconsultaAnswer: Encodable, Sendable, Equatable {
    let episodeId: String
    let recomendacion: String
    let diagnostico: String
    let tratamiento: String
    let observaciones: String
    /// Prioridad clínica (PAPER §34); vacía si no se eligió: el backend no la toca.
    let prioridad: String

    init(
        episodio: String, recomendacion: String, diagnostico: String, tratamiento: String, observaciones: String,
        prioridad: ClinicalPriority? = nil,
    ) {
        func limpio(_ texto: String) -> String { texto.trimmingCharacters(in: .whitespacesAndNewlines) }
        episodeId = episodio
        self.recomendacion = limpio(recomendacion)
        self.diagnostico = limpio(diagnostico)
        self.tratamiento = limpio(tratamiento)
        self.observaciones = limpio(observaciones)
        self.prioridad = prioridad?.rawValue ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case episodeId = "episode_id"
        case recomendacion, diagnostico, tratamiento, observaciones, prioridad
    }
}

/// El cuerpo de `POST /api/bot/episodio/alta` (PAPER §35.2): la nota es opcional.
struct PatientDischargeRequest: Encodable, Sendable, Equatable {
    let episodeId: String
    let nota: String

    init(episodio: String, nota: String = "") {
        episodeId = episodio
        self.nota = nota.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    enum CodingKeys: String, CodingKey {
        case episodeId = "episode_id"
        case nota
    }
}

/// Prioridad clínica del episodio (PAPER §34). La guía es la tabla del documento abreviada, la
/// misma que `ResponderInterconsulta.vue`. La decisión es del médico responsable.
enum ClinicalPriority: String, CaseIterable, Identifiable, Sendable {
    case urgent = "Urgente"
    case preferred = "Preferente"
    case scheduled = "Programada"

    var id: String { rawValue }

    var guide: String {
        switch self {
        case .urgent:
            "Compromiso general, ampollas extensas, reacción grave a fármacos, eritrodermia, púrpura que progresa → supervisor y atención presencial ya"
        case .preferred:
            "Sospecha de cáncer, crecimiento rápido, úlcera o sangrado persistente, inmunosuprimido → ruta prioritaria"
        case .scheduled:
            "Estable, sin alarma, o control de algo ya evaluado → seguimiento según plazo"
        }
    }
}

/// `{ok: true, notified}`: si se avisó al médico que envió el caso.
struct InterconsultaAnswerResult: Decodable, Sendable {
    let ok: Bool
    let notified: Bool?
}

// MARK: Consentimientos (PAPER §31)

/// Los dos consentimientos del paciente. El valor crudo es el `tipo` que entiende el bot.
enum ConsentType: String, Codable, Sendable, CaseIterable, Identifiable {
    case informado
    case privacidadDatos = "privacidad_datos"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .informado: "Consentimiento informado"
        case .privacidadDatos: "Privacidad de los datos"
        }
    }

    var signer: String {
        switch self {
        case .informado: "Lo firma el paciente"
        case .privacidadDatos: "Lo firma el profesional que atiende"
        }
    }
}

/// Una foto de hoja firmada. `attachment_id` llega null en los registros viejos cuya foto no
/// se pudo recuperar (§31.1): se muestran como «Sin foto».
struct ConsentPhoto: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let attachmentId: String?
    let date: String?
    let uploadedBy: String?

    enum CodingKeys: String, CodingKey {
        case id
        case attachmentId = "attachment_id"
        case date = "fecha"
        case uploadedBy = "subido_por"
    }
}

/// `GET /api/bot/consentimientos?patient_id=`: las fotos de cada tipo, más nuevas primero.
struct ConsentList: Decodable, Sendable {
    let informado: [ConsentPhoto]
    let privacidadDatos: [ConsentPhoto]

    enum CodingKeys: String, CodingKey {
        case informado
        case privacidadDatos = "privacidad_datos"
    }

    init(informado: [ConsentPhoto] = [], privacidadDatos: [ConsentPhoto] = []) {
        self.informado = informado
        self.privacidadDatos = privacidadDatos
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        informado = try c.decodeIfPresent([ConsentPhoto].self, forKey: .informado) ?? []
        privacidadDatos = try c.decodeIfPresent([ConsentPhoto].self, forKey: .privacidadDatos) ?? []
    }

    func photos(_ type: ConsentType) -> [ConsentPhoto] {
        switch type {
        case .informado: informado
        case .privacidadDatos: privacidadDatos
        }
    }
}

/// Cuerpo de `POST /api/bot/consentimientos`: un registro por foto ya subida. Subir es la
/// acción explícita del usuario, sin gate.
struct ConsentSave: Encodable, Sendable, Equatable {
    let patientId: String
    let type: ConsentType
    let attachmentIds: [String]

    enum CodingKeys: String, CodingKey {
        case patientId = "patient_id"
        case type = "tipo"
        case attachmentIds = "attachment_ids"
    }
}

/// `{ok: true, ids, errors}`: los registros creados y, por cada foto que no se guardó, el motivo.
struct ConsentSaveResult: Decodable, Sendable {
    let ids: [String]
    let errors: [String]

    enum CodingKeys: String, CodingKey { case ids, errors }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ids = try c.decodeIfPresent([String].self, forKey: .ids) ?? []
        errors = try c.decodeIfPresent([String].self, forKey: .errors) ?? []
    }
}
