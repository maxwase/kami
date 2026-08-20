import Foundation
import Capacitor
import CoreMotion
import CoreHaptics

/// Capacitor plugin exposing CoreMotion accelerometer readings and a
/// CoreHaptics "fold complete" tap to the web layer.
///
/// JS usage (see src/device/motion.ts for the TypeScript bridge):
///   - `startUpdates()` begins listening to accelerometer data and emits a
///     `motion` event with `{ x, y, z, timestamp }` payloads.
///   - `stopUpdates()` stops CoreMotion updates.
///   - `getAcceleration()` returns the most recent single reading.
///   - `triggerHaptic()` fires a short haptic tap via CoreHaptics, used for
///     fold-complete feedback. No-ops (resolves normally) on hardware
///     without a haptics engine (e.g. simulators, older devices).
///
/// NOTE: this file has not been compiled or run — there is no Xcode/iOS
/// simulator available in this environment. It is written to match the
/// documented CoreMotion / CoreHaptics / Capacitor plugin APIs, but should
/// be built and smoke-tested in Xcode before shipping.
@objc(MotionPlugin)
public class MotionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MotionPlugin"
    public let jsName = "Motion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAcceleration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "triggerHaptic", returnType: CAPPluginReturnPromise),
    ]

    private let motionManager = CMMotionManager()
    private let motionQueue = OperationQueue()
    private var lastAcceleration: CMAcceleration = CMAcceleration(x: 0, y: 0, z: 0)

    private var hapticEngine: CHHapticEngine?

    override public func load() {
        motionQueue.name = "eu.maxwase.kami.motion"
        setUpHapticEngineIfSupported()
    }

    // MARK: - CoreMotion

    @objc func startUpdates(_ call: CAPPluginCall) {
        guard motionManager.isAccelerometerAvailable else {
            call.reject("Accelerometer not available on this device")
            return
        }

        let interval = call.getDouble("intervalMs").map { $0 / 1000.0 } ?? (1.0 / 60.0)
        motionManager.accelerometerUpdateInterval = interval

        motionManager.startAccelerometerUpdates(to: motionQueue) { [weak self] data, error in
            guard let self = self else { return }
            if let error = error {
                self.notifyListeners("motionError", data: ["message": error.localizedDescription])
                return
            }
            guard let data = data else { return }
            self.lastAcceleration = data.acceleration
            self.notifyListeners("motion", data: [
                "x": data.acceleration.x,
                "y": data.acceleration.y,
                "z": data.acceleration.z,
                "timestamp": data.timestamp,
            ])
        }

        call.resolve()
    }

    @objc func stopUpdates(_ call: CAPPluginCall) {
        motionManager.stopAccelerometerUpdates()
        call.resolve()
    }

    @objc func getAcceleration(_ call: CAPPluginCall) {
        call.resolve([
            "x": lastAcceleration.x,
            "y": lastAcceleration.y,
            "z": lastAcceleration.z,
        ])
    }

    // MARK: - CoreHaptics

    private func setUpHapticEngineIfSupported() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            hapticEngine = try CHHapticEngine()
            hapticEngine?.resetHandler = { [weak self] in
                try? self?.hapticEngine?.start()
            }
            hapticEngine?.stoppedHandler = { _ in }
            try hapticEngine?.start()
        } catch {
            hapticEngine = nil
        }
    }

    @objc func triggerHaptic(_ call: CAPPluginCall) {
        guard let hapticEngine = hapticEngine else {
            // No haptics hardware/engine available — treat as a no-op success
            // rather than an error so callers don't need special-casing.
            call.resolve()
            return
        }

        let intensity = CHHapticEventParameter(
            parameterID: .hapticIntensity,
            value: Float(call.getDouble("intensity") ?? 0.8)
        )
        let sharpness = CHHapticEventParameter(
            parameterID: .hapticSharpness,
            value: Float(call.getDouble("sharpness") ?? 0.6)
        )
        let event = CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [intensity, sharpness],
            relativeTime: 0
        )

        do {
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try hapticEngine.makePlayer(with: pattern)
            try hapticEngine.start()
            try player.start(atTime: CHHapticTimeImmediate)
            call.resolve()
        } catch {
            call.reject("Failed to play haptic: \(error.localizedDescription)")
        }
    }
}
