import SwiftUI

/// Turnos: quién está de llamada cada semana en un grupo (PAPER §32.3). Una derivación al
/// grupo avisa solo a quien está de turno ese día. Tercera sección fuera del paciente
/// (§24.2.1); la referencia de comportamiento es `Turnos.vue`.
struct ShiftsView: View {
    @Environment(Sesion.self) private var sesion
    @State private var model = ShiftsModel()

    var body: some View {
        NavigationStack {
            List {
                header
                if let error = model.error {
                    Section {
                        Text(error).foregroundStyle(.red)
                        Button("Reintentar") { Task { await reload() } }
                    }
                } else if model.weeks.isEmpty {
                    Section {
                        HStack(spacing: 8) {
                            if model.loading || model.loadingGroups { ProgressView() }
                            Text(emptyText).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    ForEach(model.weeks) { week in
                        weekSection(week)
                    }
                }
            }
            .navigationTitle("Turnos")
            .refreshable { await reload() }
            .safeAreaInset(edge: .bottom) {
                if let notice = model.notice {
                    Text(notice)
                        .font(.footnote)
                        .foregroundStyle(model.noticeIsError ? .red : .green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.vertical, 10)
                        .background(.bar)
                }
            }
        }
        // Otra org es otro juego de grupos y de turnos.
        .task(id: sesion.usuario?.orgActiva) {
            let before = model.selectedGroup
            await model.loadGroups(api: sesion.api)
            // Si el grupo cambió, lo carga la tarea de abajo.
            if model.selectedGroup == before { await model.load(api: sesion.api) }
        }
        .task(id: model.selectedGroup) {
            model.clearNotice()
            model.selection = [:]
            await model.load(api: sesion.api)
        }
    }
}

private extension ShiftsView {
    /// El backend es quien manda; esto solo decide si se ofrecen los controles de edición.
    var canEdit: Bool {
        let permissions = sesion.usuario?.permissions ?? []
        return permissions.contains("groups:manage_shifts") || permissions.contains("*:*:*:*")
    }

    var emptyText: String {
        if model.loadingGroups { return "Cargando grupos…" }
        if model.groups.isEmpty { return "No hay grupos con turnos en esta organización" }
        return "Cargando turnos…"
    }

    func reload() async {
        if model.groups.isEmpty { await model.loadGroups(api: sesion.api) }
        await model.load(api: sesion.api)
    }

    var header: some View {
        @Bindable var model = model
        return Section {
            Picker("Grupo", selection: $model.selectedGroup) {
                if model.groups.isEmpty {
                    Text(model.loadingGroups ? "Cargando grupos…" : "Sin grupos").tag("")
                }
                ForEach(model.groups) { group in
                    Text(group.nombre).tag(group.slug)
                }
            }
            .disabled(model.groups.isEmpty)
            Text("De turno hoy: \(Text(model.onCallText).bold().foregroundStyle(.primary))")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    func weekSection(_ week: ShiftWeek) -> some View {
        Section {
            if week.shifts.isEmpty {
                Text("Sin asignar").foregroundStyle(.secondary)
            }
            ForEach(week.shifts) { shift in
                personRow(shift, in: week)
            }
            if canEdit { assignRow(week) }
        } header: {
            HStack(spacing: 8) {
                Text(week.rangeText)
                if week.isCurrent {
                    Text("Esta semana")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.accentColor))
                }
            }
        }
        .listRowBackground(week.isCurrent ? Color.accentColor.opacity(0.08) : nil)
    }

    func personRow(_ shift: Shift, in week: ShiftWeek) -> some View {
        HStack {
            Text(shift.displayName)
            if week.isPartial(shift) {
                Text("(\(ShiftCalendar.shortDay(shift.startsOn))–\(ShiftCalendar.shortDay(shift.endsOn)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if canEdit {
                Button(role: .destructive) {
                    Task { await model.remove(shift, api: sesion.api) }
                } label: {
                    Label("Quitar", systemImage: "xmark.circle")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(.borderless)
                .disabled(model.busy)
                .accessibilityLabel("Quitar a \(shift.displayName)")
            }
        }
    }

    func assignRow(_ week: ShiftWeek) -> some View {
        let free = model.freeMembers(week)
        let selected = Binding(
            get: { model.selection[week.start] ?? "" },
            set: { model.selection[week.start] = $0 }
        )
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("Asignar", selection: selected) {
                    Text(free.isEmpty ? "Sin miembros libres" : "Elegir…").tag("")
                    ForEach(free) { member in
                        Text(ShiftsModel.memberName(member)).tag(member.usuario)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .disabled(model.busy || free.isEmpty)
                .accessibilityLabel("Asignar semana del \(week.rangeText)")
                Spacer()
                Button("Asignar") {
                    Task { await model.assign(week, api: sesion.api) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.assignBlockReason(week) != nil)
            }
            // «Elegir…» ya dice qué falta; el motivo escrito es para lo que no se ve.
            if let reason = model.assignBlockReason(week), model.busy || free.isEmpty {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
