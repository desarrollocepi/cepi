import Foundation
import Observation

/// Estado de la sección Turnos (PAPER §32.3): grupos, miembros y turnos del grupo elegido, y
/// los cambios que hace quien tiene `groups:manage_shifts`. Espejo de `Turnos.vue`.
@MainActor
@Observable
final class ShiftsModel {
    static let defaultGroup = "dermatologia"

    private(set) var groups: [GrupoDerivacion] = []
    /// Slug del grupo elegido; `""` mientras no hay grupos.
    var selectedGroup = ""
    private(set) var loadingGroups = false
    private(set) var members: [MiembroGrupo] = []
    private(set) var shifts: [Shift] = []
    /// «Hoy» según el servidor; `nil` hasta la primera respuesta.
    private(set) var today: String?
    private(set) var loading = false
    /// Guardando un cambio: los controles de edición se deshabilitan.
    private(set) var busy = false
    private(set) var error: String?
    private(set) var notice: String?
    private(set) var noticeIsError = false
    /// A quién se eligió para cada semana (clave: lunes).
    var selection: [String: String] = [:]

    @ObservationIgnored private var request = 0

    var weeks: [ShiftWeek] {
        guard let today else { return [] }
        return ShiftCalendar.weeks(today: today, shifts: shifts)
    }

    var onCallToday: [String] {
        guard let today else { return [] }
        return ShiftCalendar.onCall(on: today, shifts: shifts)
    }

    /// «De turno hoy: …»
    var onCallText: String {
        onCallToday.isEmpty ? "nadie asignado (avisa a todo el grupo)" : onCallToday.joined(separator: ", ")
    }

    /// Miembros del grupo que todavía no están en esa semana.
    func freeMembers(_ week: ShiftWeek) -> [MiembroGrupo] {
        let taken = Set(week.shifts.map(\.userId))
        return members.filter { !taken.contains($0.usuario) }
    }

    static func memberName(_ member: MiembroGrupo) -> String {
        member.nombre ?? member.email ?? "Sin nombre"
    }

    /// Por qué no se puede asignar en esa semana; `nil` = se puede.
    func assignBlockReason(_ week: ShiftWeek) -> String? {
        if busy { return "Espera a que termine el cambio anterior" }
        if freeMembers(week).isEmpty { return "Todos los miembros del grupo ya están en esta semana" }
        if (selection[week.start] ?? "").isEmpty { return "Elige a quién asignar" }
        return nil
    }

    func clearNotice() {
        notice = nil
        noticeIsError = false
    }

    // MARK: Carga

    func loadGroups(api: CEPIAPI) async {
        loadingGroups = true
        defer { loadingGroups = false }
        do {
            // El virtual «Todos» no tiene turnos: no se ofrece.
            let all = try await api.grupos().filter { $0.tipo != "all" }
            groups = all
            if !all.contains(where: { $0.slug == selectedGroup }) {
                selectedGroup = (all.first { $0.slug == Self.defaultGroup } ?? all.first)?.slug ?? ""
            }
        } catch {
            guard !Task.isCancelled else { return }
            self.error = "No se pudieron cargar los grupos: \(error.localizedDescription)"
        }
    }

    func load(api: CEPIAPI) async {
        let group = selectedGroup
        guard !group.isEmpty else { return }
        request += 1
        let mine = request
        loading = true
        error = nil
        defer { if mine == request { loading = false } }
        do {
            // La primera vez se pide con la fecha del dispositivo. «Hoy» lo manda el servidor
            // (zona horaria de los turnos): si cae en otra semana, se pide el rango correcto.
            let firstDay = today ?? ShiftCalendar.localToday()
            var (list, memberList) = try await Self.fetch(group: group, day: firstDay, api: api)
            var day = list.today ?? firstDay
            if ShiftCalendar.monday(of: day) != ShiftCalendar.monday(of: firstDay) {
                (list, memberList) = try await Self.fetch(group: group, day: day, api: api)
                day = list.today ?? day
            }
            guard mine == request else { return }
            today = day
            shifts = list.data
            members = memberList
        } catch {
            guard mine == request, !Task.isCancelled else { return }
            self.error = "No se pudieron cargar los turnos: \(error.localizedDescription)"
        }
    }

    private nonisolated static func fetch(
        group: String, day: String, api: CEPIAPI
    ) async throws -> (ShiftList, [MiembroGrupo]) {
        let range = ShiftCalendar.range(today: day)
        async let shiftsRequest = api.shifts(group: group, from: range.from, to: range.to)
        async let membersRequest = api.miembros(grupo: group)
        return try await (shiftsRequest, membersRequest)
    }

    // MARK: Cambios

    func assign(_ week: ShiftWeek, api: CEPIAPI) async {
        guard let userId = selection[week.start], !userId.isEmpty, !busy else { return }
        let name = members.first { $0.usuario == userId }.map(Self.memberName) ?? ""
        await change(api: api, success: "\(name) quedó de turno la semana del \(week.rangeText)") {
            _ = try await api.createShift(
                group: self.selectedGroup,
                ShiftCreate(userId: userId, startsOn: week.start, endsOn: week.end)
            )
            self.selection[week.start] = nil
        }
    }

    func remove(_ shift: Shift, api: CEPIAPI) async {
        guard !busy else { return }
        await change(api: api, success: "Se quitó a \(shift.displayName) del turno") {
            try await api.deleteShift(group: self.selectedGroup, id: shift.id)
        }
    }

    private func change(api: CEPIAPI, success: String, _ action: () async throws -> Void) async {
        busy = true
        clearNotice()
        defer { busy = false }
        do {
            try await action()
            notice = success
            await load(api: api)
        } catch {
            noticeIsError = true
            notice = "No se pudo guardar: \(error.localizedDescription)"
        }
    }
}
