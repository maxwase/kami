#import <Capacitor/Capacitor.h>

// Objective-C bridge registering MotionPlugin with the Capacitor runtime.
//
// This is the classic CAP_PLUGIN macro registration used by older
// Capacitor versions. MotionPlugin.swift also conforms to
// CAPBridgedPlugin, which is sufficient for plugin discovery on
// Capacitor 4+ SwiftPM-based projects — this file is kept alongside it
// for compatibility with tooling that still expects an .m registration
// and to make the exposed method names explicit at a glance.
CAP_PLUGIN(MotionPlugin, "Motion",
           CAP_PLUGIN_METHOD(startUpdates, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stopUpdates, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(getAcceleration, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(triggerHaptic, CAPPluginReturnPromise);
)
