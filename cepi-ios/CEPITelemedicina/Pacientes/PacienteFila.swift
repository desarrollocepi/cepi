import SwiftUI

struct PacienteFila: View {
    let fila: FilaPaciente
    let revision: PendienteRevision?
    let asignacion: Asignacion?

    var body: some View {
        HStack(spacing: 12) {
            Text(fila.iniciales.isEmpty ? "?" : fila.iniciales)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Marca.acento, in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(fila.nombre)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Text("CC: \(fila.cedula ?? "—")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let nombre = asignacion?.nombre {
                    Label(nombre, systemImage: iconoACargo)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Marca.acento)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if let revision {
                Text("revisar")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Marca.revisar, in: Capsule())
                    .accessibilityLabel("\(revision.pendientes) pendiente(s) de revisión derivadas a ti")
            }
        }
        .padding(.vertical, 2)
    }

    /// Cómo quedó a cargo, como `acargoMeta` en ChatList.vue.
    private var iconoACargo: String {
        switch asignacion?.origen {
        case "derivado_grupo": "person.3"
        case "derivado": "arrow.turn.up.right"
        case "creador": "person"
        default: "stethoscope"
        }
    }
}
