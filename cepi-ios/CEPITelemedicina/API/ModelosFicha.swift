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
