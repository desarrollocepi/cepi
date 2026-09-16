import SwiftUI

/// §4.6: las dos siluetas con sus 38 regiones tocables (BodyMapField.vue).
struct CampoMapaCorporal: View {
    @Binding var csv: String

    var body: some View {
        let elegidas = RegionCorporal.seleccion(csv)
        VStack(alignment: .leading, spacing: 6) {
            Image("Cuerpos")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .overlay {
                    GeometryReader { geometria in
                        ForEach(RegionCorporal.todas) { region in
                            boton(region, elegida: elegidas.contains(region.clave), en: geometria.size)
                        }
                    }
                }
            Text(RegionCorporal.resumen(csv))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func boton(_ region: RegionCorporal, elegida: Bool, en tamano: CGSize) -> some View {
        let ancho = tamano.width * region.ancho / 100
        let alto = tamano.height * region.alto / 100
        let centro = CGPoint(
            x: tamano.width * (region.izquierda + region.ancho / 2) / 100,
            y: tamano.height * (region.arriba + region.alto / 2) / 100
        )
        return Button {
            csv = RegionCorporal.alternar(region.clave, en: csv)
        } label: {
            Ellipse()
                .fill(elegida ? Color.red.opacity(0.34) : Color.clear)
                .overlay(Ellipse().strokeBorder(elegida ? Color.red : Color.primary.opacity(0.12), lineWidth: 1))
                .contentShape(Ellipse())
        }
        .buttonStyle(.plain)
        // El óvalo circunscribe la región en vez de quedar inscrito, igual que en la web.
        .frame(width: ancho * 1.414, height: alto * 1.414)
        .position(centro)
        .accessibilityLabel(region.etiqueta)
        .accessibilityAddTraits(elegida ? .isSelected : [])
    }
}
