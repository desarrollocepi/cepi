import SwiftUI

/// La ficha de evolución del paciente (PAPER §28): fecha, médico, diagnóstico y tratamiento de
/// cada ficha, la más nueva primero. La ficha que se está viendo va resaltada; tocar otra lleva
/// el visor a esa. Se pide cada vez que se abre: entre una vez y otra se pudo guardar un
/// diagnóstico.
struct EvolucionView: View {
    let pacienteId: String
    /// La ficha abierta en el visor.
    let actual: String?
    let alElegir: (FilaEvolucion) -> Void

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var filas: [FilaEvolucion] = []
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if cargando && filas.isEmpty {
                    ProgressView()
                } else if let error {
                    ContentUnavailableView {
                        Label("Sin evolución", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Reintentar") { Task { await cargar() } }
                    }
                } else if filas.isEmpty {
                    ContentUnavailableView(
                        "Sin fichas",
                        systemImage: "doc.text",
                        description: Text("Este paciente todavía no tiene fichas registradas."),
                    )
                } else {
                    List(filas) { fila in
                        Button {
                            alElegir(fila)
                            cerrar()
                        } label: {
                            FilaEvolucionVista(fila: fila, esActual: fila.episodio == actual)
                        }
                        .disabled(fila.episodio == actual)
                        .listRowBackground(fila.episodio == actual ? Color.accentColor.opacity(0.12) : nil)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Evolución del paciente")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { cerrar() }
                }
            }
        }
        .task { await cargar() }
    }

    private func cargar() async {
        cargando = true
        error = nil
        defer { cargando = false }
        do {
            filas = try await sesion.api.evolucion(paciente: pacienteId)
        } catch {
            self.error = "No se pudo cargar la evolución: \(error.localizedDescription)"
        }
    }
}

private struct FilaEvolucionVista: View {
    let fila: FilaEvolucion
    let esActual: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text((fila.fecha ?? "s/f") + (esActual ? " · la que estás viendo" : ""))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            dato("Médico", fila.medico, vacio: "—")
            dato("Diagnóstico", fila.diagnostico, vacio: "Sin diagnóstico")
            dato("Tratamiento", fila.tratamiento, vacio: "Sin tratamiento")
        }
        .padding(.vertical, 4)
    }

    /// Sin valor, en gris e itálica: no es un error, es que no se registró.
    private func dato(_ etiqueta: String, _ valor: String?, vacio: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(etiqueta)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 88, alignment: .leading)
            Text(valor ?? vacio)
                .font(.callout)
                .italic(valor == nil)
                .foregroundStyle(valor == nil ? .secondary : .primary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
