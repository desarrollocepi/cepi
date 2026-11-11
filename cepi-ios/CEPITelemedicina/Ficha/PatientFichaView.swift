import SwiftUI

/// La sección Ficha del paciente: la ficha **editable y adaptable**, igual que la pestaña de la
/// web (`FichaCompleta.vue`, PAPER §24.2.1). Los grupos de `GET /api/bot/ficha` por categoría,
/// con lo cargado y «Completar» / «Editar», que abre el mismo formulario del chat. El documento
/// imprimible (`ficha.html`, `VisorFicha`) queda detrás de «Imprimir». La consulta la elige el
/// navegador de episodios del paciente (`EpisodeNavigatorBar`, PAPER §28.4.1).
struct PatientFichaView: View {
    let patientId: String
    let name: String
    /// El episodio elegido en el navegador del paciente; `nil` mientras no se sabe (la más nueva).
    let episode: String?
    /// Lleva a la sección Evolución del paciente (PAPER §28.3).
    var onShowEvolution: () -> Void = {}
    /// Guarda lo editado en el documento imprimible (`ficha_save` por el hilo).
    let onPrintSave: ([String: JSONValor], String?) async -> Bool

    @Environment(Sesion.self) private var sesion
    @State private var model: FichaModel
    @State private var printing = false
    @State private var saveError: String?

    init(
        patientId: String, name: String, episode: String?, onShowEvolution: @escaping () -> Void = {},
        onPrintSave: @escaping ([String: JSONValor], String?) async -> Bool
    ) {
        self.patientId = patientId
        self.name = name
        self.episode = episode
        self.onShowEvolution = onShowEvolution
        self.onPrintSave = onPrintSave
        _model = State(initialValue: FichaModel(patientId: patientId))
    }

    var body: some View {
        VStack(spacing: 0) {
            changesNote
            ScrollView {
                content
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
            .refreshable { await Task { await model.reload(api: sesion.api) }.value }
            // Recargar no vacía la ficha: se atenúa y no se puede tocar, pero sigue a la vista.
            .opacity(reloading ? 0.45 : 1)
            .allowsHitTesting(!reloading)
            .overlay(alignment: .top) {
                if reloading {
                    ProgressView().padding(8)
                }
            }
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .task { await model.open(preferred: episode, api: sesion.api) }
        .onChange(of: episode) { _, episode in
            // Una consulta que ya está en la lista solo se muestra; una nueva relee la lista
            // (hace falta para comparar con la anterior).
            if let episode, model.visits.contains(where: { $0.id == episode }) {
                Task { await model.show(episode, api: sesion.api) }
            } else {
                Task { await model.open(preferred: episode, api: sesion.api) }
            }
        }
        .sheet(item: Binding(get: { model.editing }, set: { model.editing = $0 })) { group in
            editSheet(group)
        }
        .sheet(isPresented: $printing) {
            VisorFicha(
                pacienteId: patientId,
                nombre: name,
                episodioActivo: model.episodeId,
                onShowEvolution: {
                    printing = false
                    onShowEvolution()
                }
            ) { datos, episodio in
                let saved = await onPrintSave(datos, episodio)
                if saved { await model.reload(api: sesion.api) }
                return saved
            }
            .environment(sesion)
        }
    }

    private var reloading: Bool { model.loading && model.ficha != nil }

    // MARK: Contenido

    @ViewBuilder
    private var content: some View {
        if model.loading && model.ficha == nil {
            ProgressView("Cargando ficha…")
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
        } else if let error = model.error {
            VStack(spacing: 10) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                Button("Reintentar") { Task { await model.reload(api: sesion.api) } }
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 40)
        } else if model.groups.isEmpty {
            Text("Esta ficha no tiene grupos.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
        } else {
            LazyVStack(alignment: .leading, spacing: 14) {
                if let answer = model.specialistAnswer {
                    answerBlock(answer)
                }
                progressHeader
                ForEach(model.categories) { category in
                    categorySection(category)
                }
            }
        }
    }

    /// La respuesta a la interconsulta tiene que verse en la ficha, no solo en el chat.
    private func answerBlock(_ answer: FichaLogic.SpecialistAnswer) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Respuesta del especialista").font(.subheadline.weight(.semibold))
                if let date = answer.date {
                    Text(String(date.prefix(10))).font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(answer.text)
                .font(.subheadline)
                .textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.green.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.green).frame(width: 4)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }

    /// «¿Qué falta?» es la primera pregunta: el progreso va arriba.
    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            ProgressView(value: Double(model.percent), total: 100)
            HStack(alignment: .firstTextBaseline) {
                Text(FichaLogic.progressText(complete: model.complete, total: model.total))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Toggle("Solo lo que falta", isOn: Binding(get: { model.onlyMissing }, set: { model.onlyMissing = $0 }))
                    .toggleStyle(.button)
                    .controlSize(.small)
                    .font(.caption)
                    .accessibilityIdentifier("ficha.soloFaltantes")
            }
            if let notice = model.notice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(model.noticeIsError ? Color.red : Color.green)
            }
        }
    }

    private func categorySection(_ category: FichaLogic.Category) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(category.name.uppercased())
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.secondary)
                Text("\(category.complete)/\(category.groups.count)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            ForEach(category.visible) { group in
                groupCard(group)
            }
        }
    }

    private func groupCard(_ group: FichaGroup) -> some View {
        let values = model.values(of: group)
        let blockReason = FichaLogic.editBlockReason(group)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Image(systemName: group.done ? "circle.fill" : "circle")
                    .font(.caption2)
                    .foregroundStyle(group.done ? Marca.acento : Color.secondary)
                Text(group.label)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 4)
                // Nunca se esconde: los grupos de fotos salen grises con el motivo debajo.
                Button(FichaLogic.editTitle(group)) { model.edit(group) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(blockReason != nil || model.saving)
                    .accessibilityHint(blockReason ?? "Abre el formulario de este grupo")
                    .accessibilityIdentifier("ficha.editar.\(group.id)")
            }
            if let blockReason {
                Text(blockReason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if values.isEmpty {
                Text("Sin dato")
                    .font(.footnote)
                    .italic()
                    .foregroundStyle(.secondary)
            } else {
                ForEach(values) { value in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(value.label)
                            .font(.caption.weight(value.changed ? .heavy : .regular))
                            .foregroundStyle(value.changed ? Color.red : Color.secondary)
                        Text(value.text)
                            .font(.subheadline)
                            .textSelection(.enabled)
                        if let previous = value.previous {
                            Text("Antes: \(previous)")
                                .font(.caption2)
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            group.done ? Color(uiColor: .systemBackground) : Color(uiColor: .secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 8)
        )
        .overlay {
            // Un grupo vacío no es un error (las fichas espejadas nunca lo tuvieron): gris y
            // punteado, sin alarma.
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(Color.secondary.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: group.done ? [] : [4]))
        }
    }

    @ViewBuilder
    private func editSheet(_ group: FichaGroup) -> some View {
        if let form = FichaLogic.editableForm(group) {
            FormularioBotView(
                formulario: form,
                ocupado: model.saving,
                alEnviar: { data in
                    Task {
                        if let error = await model.save(group, data: data, api: sesion.api) { saveError = error }
                    }
                },
                // Los grupos de la ficha no tienen acciones ni búsqueda de registros que manden
                // un mensaje: no hay conversación detrás.
                alMandar: { _ in },
                alCerrar: { model.cancelEditing() }
            )
            .presentationDetents([.medium, .large])
            .environment(sesion)
            .alert("No se pudo guardar", isPresented: Binding(
                get: { saveError != nil },
                set: { if !$0 { saveError = nil } }
            )) {
                Button("Aceptar", role: .cancel) {}
            } message: {
                Text(saveError ?? "")
            }
        }
    }

    // MARK: Barras

    /// Qué cambió respecto del episodio anterior. Anterior / Siguiente viven en el navegador
    /// del paciente (`EpisodeNavigatorBar`); esto es lo propio de la ficha: lo cambiado va en rojo.
    private var changesNote: some View {
        let highlight = model.changeCount > 0 && model.navigation.hasPrevious
        return Text(model.navigationNote)
            .font(.caption2.weight(highlight ? .bold : .regular))
            .foregroundStyle(highlight ? Color.red : Color.secondary)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(.bar)
            .accessibilityIdentifier("ficha.cambios")
    }

    /// El documento imprimible y la evolución, donde se ven siempre.
    private var bottomBar: some View {
        HStack {
            Button("Imprimir", systemImage: "printer") { printing = true }
                .disabled(model.loading && model.ficha == nil)
                .accessibilityHint("Abre la ficha como documento para imprimir")
            Spacer()
            Button("Evolución", systemImage: "list.bullet.rectangle", action: onShowEvolution)
                .accessibilityHint("Abre la sección Evolución del paciente.")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}
