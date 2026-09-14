import SwiftUI

@main
struct CEPITelemedicinaApp: App {
    @State private var sesion = Sesion()

    var body: some Scene {
        WindowGroup {
            RaizView()
                .environment(sesion)
        }
    }
}
