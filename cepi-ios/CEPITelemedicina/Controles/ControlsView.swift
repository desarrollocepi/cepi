import SwiftUI

/// Controles: cuándo vuelve cada paciente y qué hay que hacer (PAPER §33), para que el cambio
/// de internos no pierda nada. Cuarta sección fuera del paciente (§24.2.1); la referencia de
/// comportamiento es `Controles.vue`. Tocar una fila abre al paciente en su Ficha.
struct ControlsView: View {
    @Environment(Sesion.self) private var sesion
    @State private var model = ControlsModel()
    /// La sección del paciente abierto: arranca en la Ficha.
    @State private var section: PacienteView.Seccion = .ficha

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            List {
                if let error = model.error {
                    Section {
                        Text(error).foregroundStyle(.red)
                        Button("Reintentar") { Task { await model.load(api: sesion.api) } }
                    }
                } else if !model.loaded {
                    Section {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Cargando controles…").foregroundStyle(.secondary)
                        }
                    }
                } else if model.groups.isEmpty {
                    Section {
                        Text(model.emptyText).foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(model.groups) { group in
                        groupSection(group)
                    }
                }
            }
            .navigationTitle("Controles")
            .searchable(
                text: $model.query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Paciente o cédula"
            )
            .refreshable { await Task { await model.load(api: sesion.api) }.value }
            .navigationDestination(item: $model.openedPatient) { patient in
                PacienteView(
                    fila: patient, seccion: $section,
                    onListChanged: { await model.load(api: sesion.api) }
                ) {
                    model.openedPatient = nil
                }
                .id(patient.id)
            }
            .alert("No se pudo abrir el paciente", isPresented: Binding(
                get: { model.openError != nil },
                set: { if !$0 { model.openError = nil } }
            )) {
                Button("Aceptar", role: .cancel) {}
            } message: {
                Text(model.openError ?? "")
            }
        }
        // Otra org es otra lista de controles.
        .task(id: sesion.usuario?.orgActiva) {
            model.reset()
            await model.load(api: sesion.api)
        }
    }
}

private extension ControlsView {
    func groupSection(_ group: ControlGroup) -> some View {
        Section {
            ForEach(group.controls) { control in
                row(control)
            }
        } header: {
            HStack(spacing: 6) {
                Text(group.title)
                    .foregroundStyle(group.isOverdue ? Color.red : Color.primary)
                Text("\(group.controls.count)")
                    .foregroundStyle(.secondary)
            }
            .font(.footnote.weight(.bold))
        }
    }

    func row(_ control: PatientControl) -> some View {
        let canOpen = control.patientId != nil
        return Button {
            section = .ficha
            Task { await model.open(control, api: sesion.api) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(stripe(control.status))
                    .frame(width: 4)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(ControlsCalendar.weekday(control.controlDate).capitalized)
                            .font(.subheadline.weight(.semibold))
                        Text(ControlsCalendar.longDate(control.controlDate))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        chip(control.status)
                        Spacer(minLength: 0)
                        if model.openingEpisode == control.episodeId { ProgressView() }
                    }
                    Text("\(Text(control.patientName ?? "Paciente sin nombre").fontWeight(.semibold))\(Text(control.cedula.map { " · \($0)" } ?? "").foregroundStyle(.secondary))")
                        .font(.body)
                    Text(control.reason ?? "Sin indicación de qué hacer")
                        .font(.subheadline)
                        .foregroundStyle(control.reason == nil ? .secondary : .primary)
                    if let plan = control.plan {
                        Text("Plan: \(plan)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    let meta = ControlsCalendar.metaLine(control)
                    if !meta.isEmpty {
                        Text(meta)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !canOpen {
                        Text("El paciente ya no está disponible")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canOpen || model.openingEpisode != nil)
        .opacity(canOpen ? 1 : 0.6)
        .accessibilityHint(canOpen ? "Abre la ficha del paciente" : "El paciente ya no está disponible")
    }

    func stripe(_ status: ControlStatus) -> Color {
        switch status {
        case .overdue: .red
        case .today: .accentColor
        case .upcoming: .clear
        }
    }

    @ViewBuilder
    func chip(_ status: ControlStatus) -> some View {
        switch status {
        case .overdue: chipLabel("Atrasado", color: .red)
        case .today: chipLabel("Hoy", color: .accentColor)
        case .upcoming: EmptyView()
        }
    }

    func chipLabel(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Capsule().fill(color))
    }
}
