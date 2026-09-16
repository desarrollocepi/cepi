import SwiftUI

/// Las secciones de la ficha agrupadas por categoría, con lo ya completo marcado. Elegir una
/// abre su formulario en el hilo (el menú "Secciones" de IntakeChat.vue).
struct SeccionesView: View {
    let marcadores: [Marcador]
    let alElegir: (Marcador) -> Void

    @Environment(\.dismiss) private var cerrar

    var body: some View {
        NavigationStack {
            List {
                ForEach(Marcador.porCategoria(marcadores), id: \.categoria) { grupo in
                    Section(grupo.categoria) {
                        ForEach(grupo.marcadores) { marcador in
                            Button {
                                cerrar()
                                alElegir(marcador)
                            } label: {
                                HStack {
                                    Image(systemName: marcador.hecho ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(marcador.hecho ? Color.green : Color.secondary)
                                    Text(marcador.etiqueta)
                                        .foregroundStyle(marcador.hecho ? Color.secondary : Color.primary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Secciones de la ficha")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { cerrar() }
                }
            }
        }
    }
}
