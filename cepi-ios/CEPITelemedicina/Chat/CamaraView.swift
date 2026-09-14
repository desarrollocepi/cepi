import SwiftUI
import UIKit

/// La cámara del sistema para fotografiar una lesión o un consentimiento.
struct CamaraView: UIViewControllerRepresentable {
    let alTomar: (UIImage) -> Void

    @Environment(\.dismiss) private var cerrar

    /// El simulador y algunos iPad no tienen cámara: el botón se muestra gris en ese caso.
    static var disponible: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let selector = UIImagePickerController()
        selector.sourceType = .camera
        selector.delegate = context.coordinator
        return selector
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinador {
        Coordinador(self)
    }

    final class Coordinador: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let padre: CamaraView

        init(_ padre: CamaraView) {
            self.padre = padre
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let imagen = info[.originalImage] as? UIImage {
                padre.alTomar(imagen)
            }
            padre.cerrar()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            padre.cerrar()
        }
    }
}
