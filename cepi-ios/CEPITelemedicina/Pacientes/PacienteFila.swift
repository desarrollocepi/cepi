import SwiftUI

/// Una fila de la lista. El LED de la derecha es el estado de la ficha actual: va al costado
/// y no en una línea más, para que la fila no crezca.
struct PacienteFila: View {
    let fila: FilaPaciente
    let revision: PendienteRevision?
    let asignacion: Asignacion?
    let estado: EstadoFicha
    /// Solo quien tiene el permiso ve «Archivar» (D-Aux-23).
    var puedeArchivar = false
    /// La acción elegida en el menú «⋯» de la fila.
    var alElegir: (Accion) -> Void = { _ in }

    enum Accion { case chat, ficha, imagenes, copiarCedula, archivar }

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
                    // El círculo de iniciales también es texto: sin esto, quien lea la fila de
                    // afuera (los UI tests) se queda con "FS" en lugar del nombre.
                    .accessibilityIdentifier("paciente.nombre")
                Text("CC: \(fila.cedula ?? "—")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let nombre = asignacion?.aCargo {
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

            // Las acciones del paciente, como el «⋯» de ChatList.vue. `borderless`: sin él, en una
            // fila de List el toque del menú también selecciona la fila.
            Menu {
                Button("Abrir el chat", systemImage: "bubble.left") { alElegir(.chat) }
                Button("Ver la ficha", systemImage: "list.clipboard") { alElegir(.ficha) }
                Button("Ver las imágenes", systemImage: "photo.on.rectangle") { alElegir(.imagenes) }
                Button(
                    fila.cedula == nil ? "Copiar la cédula (no tiene)" : "Copiar la cédula",
                    systemImage: "doc.on.doc"
                ) { alElegir(.copiarCedula) }
                    .disabled(fila.cedula == nil)
                if puedeArchivar {
                    Divider()
                    Button("Archivar paciente", systemImage: "archivebox") { alElegir(.archivar) }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Acciones de \(fila.nombre)")
            .accessibilityIdentifier("paciente.acciones")

            LedEstado(estado: estado)
                .accessibilityLabel("Ficha: \(estado.etiqueta)")
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
