import SwiftUI

/// Galería de la organización activa: las imágenes de todos los casos, con buscador por
/// paciente, cédula, diagnóstico, CIE-10 o fecha (PAPER §24.2.1).
struct GaleriaView: View {
    @Environment(Sesion.self) private var sesion
    @State private var modelo = GaleriaModelo()
    @State private var busqueda = ""

    var body: some View {
        NavigationStack {
            RejillaImagenes(modelo: modelo, vacio: "Todavía no hay imágenes en esta organización")
                .navigationTitle("Galería")
                .searchable(text: $busqueda, prompt: "Paciente, cédula, diagnóstico, CIE-10 o fecha")
                .refreshable { await modelo.recargar(api: sesion.api) }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Text(sesion.usuario?.orgs.first { $0.id == sesion.usuario?.orgActiva }?.name ?? "")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
        }
        // Cada tecla reinicia la espera: el modelo busca cuando el texto se queda quieto.
        .task(id: Busqueda(texto: busqueda, organizacion: sesion.usuario?.orgActiva)) {
            await modelo.buscar(busqueda, api: sesion.api)
        }
    }
}

/// Otra org es otra galería: cambiarla vuelve a pedir desde cero.
private struct Busqueda: Equatable {
    let texto: String
    let organizacion: String?
}
