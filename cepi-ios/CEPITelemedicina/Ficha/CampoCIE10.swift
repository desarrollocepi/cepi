import SwiftUI

/// Diagnóstico con autocompletado contra el catálogo CIE-10 del ERP (IcdSearchField.vue). Lo que
/// se escribe también vale: el médico puede dejar texto libre.
struct CampoCIE10: View {
    let campo: CampoFormulario
    @Binding var texto: String

    @Environment(Sesion.self) private var sesion
    @State private var resultados: [ResultadoCIE] = []
    @State private var buscando = false
    /// El texto que puso una elección: no se vuelve a buscar por él.
    @State private var elegido = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(campo.placeholder ?? "Buscar diagnóstico en CIE-10…", text: $texto)
                .autocorrectionDisabled()
                .estiloCampo()
            if buscando {
                Text("Buscando en CIE-10…").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(resultados, id: \.self) { resultado in
                Button {
                    let valor = (resultado.code.map { "\($0) — " } ?? "") + resultado.title
                    elegido = valor
                    texto = valor
                    resultados = []
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text(resultado.code ?? "—").bold()
                        Text(resultado.title)
                        Spacer(minLength: 0)
                    }
                    .font(.subheadline)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: texto) {
            let consulta = texto.trimmingCharacters(in: .whitespaces)
            guard consulta.count >= 3, texto != elegido else {
                resultados = []
                return
            }
            try? await Task.sleep(for: .milliseconds(280))
            guard !Task.isCancelled else { return }
            buscando = true
            let encontrados = (try? await sesion.api.buscarCIE10(consulta)) ?? []
            guard !Task.isCancelled else { return }
            resultados = encontrados
            buscando = false
        }
    }
}
