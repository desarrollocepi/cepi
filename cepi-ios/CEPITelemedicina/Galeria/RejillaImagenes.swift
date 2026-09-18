import SwiftUI

/// Rejilla de imágenes clínicas. La usan la galería de la organización y la pestaña de
/// imágenes del paciente: cambia qué se pide, no cómo se ve.
struct RejillaImagenes: View {
    let modelo: GaleriaModelo
    /// Qué decir cuando no hay ninguna (con búsqueda vacía).
    let vacio: String
    /// Con el paciente abierto no hace falta repetir su nombre en cada foto.
    var mostrarPaciente = true

    @Environment(Sesion.self) private var sesion
    @State private var abierta: ImagenGaleria?

    private let columnas = [GridItem(.adaptive(minimum: 110), spacing: 6)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columnas, spacing: 6) {
                ForEach(modelo.imagenes) { imagen in
                    Button { abierta = imagen } label: {
                        celda(imagen)
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        // Al llegar al final de lo cargado se pide la página siguiente.
                        if imagen.id == modelo.imagenes.last?.id {
                            Task { await modelo.siguientePagina(api: sesion.api) }
                        }
                    }
                }
            }
            .padding(6)

            if modelo.cargando && !modelo.imagenes.isEmpty {
                ProgressView().padding()
            }
        }
        .overlay {
            if !modelo.cargado {
                if let error = modelo.error {
                    ContentUnavailableView {
                        Label("No se pudieron cargar las imágenes", systemImage: "photo.badge.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Reintentar") { Task { await modelo.recargar(api: sesion.api) } }
                    }
                } else {
                    ProgressView("Cargando imágenes…")
                }
            } else if modelo.imagenes.isEmpty {
                if modelo.busqueda.isEmpty {
                    ContentUnavailableView(vacio, systemImage: "photo.on.rectangle")
                } else {
                    ContentUnavailableView.search(text: modelo.busqueda)
                }
            }
        }
        .fullScreenCover(item: $abierta) { imagen in
            VisorImagen(id: imagen.adjunto)
                .environment(sesion)
        }
    }

    private func celda(_ imagen: ImagenGaleria) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ImagenAutenticada(id: imagen.adjunto, ladoMaximo: 420)
                .frame(height: 110)
                .frame(maxWidth: .infinity)
                .clipped()
                .background(.fill.tertiary)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            if mostrarPaciente, let paciente = imagen.paciente, !paciente.isEmpty {
                Text(paciente)
                    .font(.caption2.weight(.medium))
                    .lineLimit(1)
            }
            Text(pie(imagen))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    /// Lo que identifica el caso de un vistazo: fecha y diagnóstico (o la región del cuerpo).
    private func pie(_ imagen: ImagenGaleria) -> String {
        let fecha = imagen.fecha.flatMap(Fechas.dia)
            .map { $0.formatted(.dateTime.day(.twoDigits).month(.abbreviated).locale(Locale(identifier: "es"))) }
            ?? String(imagen.fecha?.prefix(10) ?? "")
        let detalle = [imagen.codigoCIE10, imagen.diagnostico ?? imagen.region]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return [fecha, detalle].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
