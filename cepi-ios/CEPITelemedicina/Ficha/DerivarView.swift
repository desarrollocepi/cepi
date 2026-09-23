import SwiftUI

/// Derivar el episodio a un círculo, a una persona o al responsable del caso. Elegir un destino
/// ejecuta la derivación al instante, igual que en la web: `derivar a <slug>` o `escalar a <uuid>`.
struct DerivarView: View {
    /// Envía el comando; devuelve el error, o `nil` si el bot lo procesó.
    let alDerivar: (String) async -> String?
    let responsable: () async -> String?

    @Environment(Sesion.self) private var sesion
    @Environment(\.dismiss) private var cerrar
    @State private var grupos: [GrupoDerivacion] = []
    @State private var miembros: [String: [MiembroGrupo]] = [:]
    @State private var expandido: String?
    @State private var motivo = ""
    @State private var cargando = true
    @State private var enviando = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Motivo de la derivación (opcional)", text: $motivo, axis: .vertical)
                } footer: {
                    Text("Elegir un destino deriva al instante.")
                }

                Section {
                    Button("Al responsable del caso", systemImage: "star") {
                        Task { await alResponsable() }
                    }
                }

                Section("Círculos y especialidades") {
                    if cargando {
                        ProgressView()
                    } else if grupos.isEmpty {
                        Text("Ningún círculo tiene miembros en esta organización.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(grupos) { grupo in
                        filaGrupo(grupo)
                    }
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .disabled(enviando)
            .navigationTitle("Derivar episodio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { cerrar() }
                }
            }
            .task { await cargarGrupos() }
            .task(id: expandido) { await cargarMiembros() }
        }
    }

    @ViewBuilder
    private func filaGrupo(_ grupo: GrupoDerivacion) -> some View {
        let todaLaRed = grupo.tipo == "all"
        Button {
            Task { await derivar("derivar a \(grupo.slug)") }
        } label: {
            HStack {
                Label(grupo.nombre, systemImage: todaLaRed ? "globe" : "circle.circle")
                Spacer()
                Text(todaLaRed ? "toda la red" : (grupo.tipo ?? ""))
                    .font(.caption2)
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Text("\(grupo.miembros)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        // "Toda la red" no tiene personas que listar; el resto se abre para elegir a alguien.
        if !todaLaRed {
            DisclosureGroup(
                isExpanded: Binding(
                    get: { expandido == grupo.slug },
                    set: { expandido = $0 ? grupo.slug : nil }
                )
            ) {
                let personas = miembros[grupo.slug] ?? []
                if personas.isEmpty {
                    Text("(sin miembros)").foregroundStyle(.secondary)
                }
                ForEach(personas) { persona in
                    Button {
                        Task { await derivar("escalar a \(persona.usuario)") }
                    } label: {
                        HStack {
                            Label(persona.nombre ?? persona.email ?? "Profesional", systemImage: "person")
                            Spacer()
                            if let rol = persona.rol {
                                Text(rol).font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } label: {
                Text("Personas de \(grupo.nombre)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func cargarGrupos() async {
        defer { cargando = false }
        do {
            // Sin el turno de guardia: eso es "enviar caso", no derivar. "Toda la red" primero.
            // Un círculo sin nadie de esta organización no se ofrece: derivar ahí no llega a
            // nadie y el backend lo rechaza. Es la excepción a "nunca ocultes un botón".
            grupos = try await sesion.api.grupos()
                .filter { $0.tipo != "roster" && $0.miembros > 0 }
                .sorted { ($0.tipo == "all" ? 0 : 1) < ($1.tipo == "all" ? 0 : 1) }
        } catch {
            self.error = "No se pudieron cargar los destinos: \(error.localizedDescription)"
        }
    }

    private func cargarMiembros() async {
        guard let slug = expandido, miembros[slug] == nil else { return }
        miembros[slug] = (try? await sesion.api.miembros(grupo: slug)) ?? []
    }

    private func alResponsable() async {
        guard let usuario = await responsable() else {
            error = "El episodio no tiene responsable ni creador definido."
            return
        }
        await derivar("escalar a \(usuario)")
    }

    private func derivar(_ comando: String) async {
        enviando = true
        defer { enviando = false }
        let detalle = motivo.trimmingCharacters(in: .whitespacesAndNewlines)
        error = await alDerivar(detalle.isEmpty ? comando : "\(comando) \(detalle)")
    }
}
