import SwiftUI

/// Búsqueda de registros del ERP con carga por páginas (EntitySearchField.vue). Elegir uno
/// envía su plantilla (`on_select_send`) como mensaje, p. ej. "activar paciente {id}".
struct CampoEntidad: View {
    let campo: CampoFormulario
    let alElegir: (String) -> Void

    @Environment(Sesion.self) private var sesion
    @State private var consulta = ""
    @State private var resultados: [Registro] = []
    @State private var hayMas = false
    @State private var cargando = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(campo.placeholder ?? "", text: $consulta)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .estiloCampo()

            if consulta.trimmingCharacters(in: .whitespaces).count < campo.minimoCaracteres {
                Text("Escribe al menos \(campo.minimoCaracteres) caracteres…")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(resultados) { registro in
                    Button {
                        alElegir(LogicaFormulario.mensajeAlElegir(campo, registro: registro))
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(LogicaFormulario.etiquetaResultado(campo, registro: registro))
                                .font(.subheadline.weight(.medium))
                            if let clave = campo.subResultado, let sub = registro[clave] {
                                Text(sub).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if cargando {
                    Text("Buscando…").font(.caption).foregroundStyle(.secondary)
                } else if resultados.isEmpty {
                    Text("Sin coincidencias.").font(.caption).foregroundStyle(.secondary)
                }
                // Siempre visible: gris cuando no quedan más resultados.
                Button(hayMas ? "Cargar más" : "Fin de resultados") {
                    Task { await cargar(desdeCero: false) }
                }
                .font(.caption)
                .disabled(!hayMas || cargando)
            }
        }
        .task(id: consulta) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await cargar(desdeCero: true)
        }
    }

    private func cargar(desdeCero: Bool) async {
        let texto = consulta.trimmingCharacters(in: .whitespaces)
        guard texto.count >= campo.minimoCaracteres, let definicion = campo.definicion else {
            resultados = []
            hayMas = false
            return
        }
        cargando = true
        defer { cargando = false }
        let desde = desdeCero ? 0 : resultados.count
        let pagina = (try? await sesion.api.buscar(definicion: definicion, texto: texto, desde: desde, limite: campo.tamanoPagina)) ?? []
        guard texto == consulta.trimmingCharacters(in: .whitespaces) else { return }
        resultados = desdeCero ? pagina : resultados + pagina
        hayMas = pagina.count == campo.tamanoPagina
    }
}
