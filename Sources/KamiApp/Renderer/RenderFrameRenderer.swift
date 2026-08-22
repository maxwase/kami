import CoreGraphics
import KamiCore
import MetalKit
import UIKit

struct RenderedFrame {
    let image: UIImage
    let processedFaceCount: Int
}

enum RenderFrameRendererError: Error, Equatable {
    case invalidCanvasSize
    case metalUnavailable
    case commandQueueUnavailable
    case shaderLibraryUnavailable
    case shaderFunctionUnavailable
    case pipelineCreationFailed
    case textureCreationFailed
    case commandBufferCreationFailed
    case renderEncoderCreationFailed
    case commandExecutionFailed
    case imageCreationFailed
    case missingTexture(String)
    case textureLoadFailed(String)
}

@MainActor
final class RenderFrameRenderer {
    let metalDevice: any MTLDevice

    private let commandQueue: any MTLCommandQueue
    private let pipeline: any MTLRenderPipelineState
    private let textureCache: MetalTextureCache

    init(bundle: Bundle = .main) throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw RenderFrameRendererError.metalUnavailable
        }
        guard let commandQueue = device.makeCommandQueue() else {
            throw RenderFrameRendererError.commandQueueUnavailable
        }
        let library: any MTLLibrary
        do {
            library = try device.makeLibrary(source: MetalShaderSource.source, options: nil)
        } catch {
            throw RenderFrameRendererError.shaderLibraryUnavailable
        }
        guard
            let vertexFunction = library.makeFunction(name: "paperVertex"),
            let fragmentFunction = library.makeFunction(name: "paperFragment")
        else {
            throw RenderFrameRendererError.shaderFunctionUnavailable
        }

        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertexFunction
        descriptor.fragmentFunction = fragmentFunction
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm_srgb
        descriptor.colorAttachments[0].isBlendingEnabled = true
        descriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        descriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
        descriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        do {
            pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        } catch {
            throw RenderFrameRendererError.pipelineCreationFailed
        }

        metalDevice = device
        self.commandQueue = commandQueue
        textureCache = try MetalTextureCache(device: device, bundle: bundle)
    }

    func render(frame: RenderFrame, in size: CGSize) throws -> RenderedFrame {
        try validate(size)
        let scale = UIScreen.main.scale
        let target = try makeRenderTarget(in: size, scale: scale)
        let processedFaceCount = try draw(frame: frame, in: size, to: target)
        return RenderedFrame(
            image: try image(from: target, scale: scale),
            processedFaceCount: processedFaceCount
        )
    }

    func makeRenderTarget(in size: CGSize, scale: CGFloat = UIScreen.main.scale) throws -> any MTLTexture {
        try validate(size)
        let width = max(1, Int((size.width * scale).rounded()))
        let height = max(1, Int((size.height * scale).rounded()))
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm_srgb,
            width: width,
            height: height,
            mipmapped: false
        )
        descriptor.storageMode = .shared
        descriptor.usage = [.renderTarget, .shaderRead]
        guard let target = metalDevice.makeTexture(descriptor: descriptor) else {
            throw RenderFrameRendererError.textureCreationFailed
        }
        return target
    }

    func draw(frame: RenderFrame, in size: CGSize, to target: any MTLTexture) throws -> Int {
        try validate(size)
        guard let commandBuffer = commandQueue.makeCommandBuffer() else {
            throw RenderFrameRendererError.commandBufferCreationFailed
        }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = target
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.22, green: 0.14, blue: 0.09, alpha: 1)
        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else {
            throw RenderFrameRendererError.renderEncoderCreationFailed
        }
        encoder.setRenderPipelineState(pipeline)
        drawBackground(in: encoder)

        let sourceFaces = frame.fold.map { fold in
            fold.stationaryFaces.map { FaceInput(face: $0, moving: false) }
                + fold.movingFaces.map { FaceInput(face: $0, moving: true) }
        } ?? frame.faces.map { FaceInput(face: $0, moving: false) }
        let allPoints = sourceFaces.flatMap { $0.face.polygon.vertices }
        if let bounds = bounds(of: allPoints) {
            let projection = Projection(frame: frame, bounds: bounds, canvasSize: size)
            let items = sourceFaces.map { makeItem(input: $0, frame: frame, projection: projection) }
                .sorted { lhs, rhs in
                    abs(lhs.depth - rhs.depth) >= 0.001 ? lhs.depth < rhs.depth : lhs.layer < rhs.layer
                }
            for item in items {
                drawShadow(item, size: size, in: encoder)
                drawFace(item, style: frame.style, in: encoder)
                if frame.outlineEnabled { drawOutline(item, style: frame.style, in: encoder) }
            }
            if let hinge = frame.hinge {
                drawCrease(hinge, projection: projection, size: size, in: encoder)
            }
        }

        encoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        guard commandBuffer.status == .completed else {
            throw RenderFrameRendererError.commandExecutionFailed
        }
        return sourceFaces.count
    }

    private func validate(_ size: CGSize) throws {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else {
            throw RenderFrameRendererError.invalidCanvasSize
        }
    }

    private func drawBackground(in encoder: any MTLRenderCommandEncoder) {
        let points = [
            SIMD2<Float>(-1, -1), SIMD2<Float>(1, -1), SIMD2<Float>(1, 1),
            SIMD2<Float>(-1, -1), SIMD2<Float>(1, 1), SIMD2<Float>(-1, 1),
        ]
        let textureCoordinates = [
            SIMD2<Float>(0, 1), SIMD2<Float>(1, 1), SIMD2<Float>(1, 0),
            SIMD2<Float>(0, 1), SIMD2<Float>(1, 0), SIMD2<Float>(0, 0),
        ]
        let vertices = zip(points, textureCoordinates).map { point, textureCoordinate in
            MetalVertex(
                position: point,
                textureCoordinate: textureCoordinate,
                color: SIMD4(1, 1, 1, 1),
                light: 1,
                mode: .wood
            )
        }
        draw(vertices, primitive: .triangle, texture: textureCache.wood, in: encoder)
    }

    private func drawShadow(_ item: RenderItem, size: CGSize, in encoder: any MTLRenderCommandEncoder) {
        for pass in [(CGPoint(x: -1.5, y: 3), Float(0.035)), (CGPoint(x: 1.5, y: 3), 0.035),
                     (CGPoint(x: 0, y: 4.5), 0.055), (CGPoint(x: 0, y: 6), 0.025)] {
            let points = item.vertices.map {
                clipPoint(CGPoint(x: $0.screen.x + pass.0.x, y: $0.screen.y + pass.0.y), size: size)
            }
            let vertices = triangulatedVertices(
                points: points,
                textureCoordinates: item.vertices.map(\.textureCoordinate),
                color: SIMD4(0, 0, 0, pass.1),
                light: 1,
                mode: .solid
            )
            draw(vertices, primitive: .triangle, texture: textureCache.paper, in: encoder)
        }
    }

    private func drawFace(_ item: RenderItem, style: PaperStyle, in encoder: any MTLRenderCommandEncoder) {
        let vertices = triangulatedVertices(
            points: item.vertices.map(\.clip),
            textureCoordinates: item.vertices.map(\.textureCoordinate),
            color: color(hex: item.visibleSide == .front ? style.frontColor : style.backColor),
            light: item.light,
            mode: .paper
        )
        draw(vertices, primitive: .triangle, texture: textureCache.paper, in: encoder)
    }

    private func drawOutline(_ item: RenderItem, style: PaperStyle, in encoder: any MTLRenderCommandEncoder) {
        guard let first = item.vertices.first else { return }
        let points = item.vertices.map(\.clip) + [first.clip]
        let vertices = points.map {
            MetalVertex(
                position: $0,
                textureCoordinate: .zero,
                color: color(hex: style.edgeColor),
                light: 1,
                mode: .solid
            )
        }
        draw(vertices, primitive: .lineStrip, texture: textureCache.paper, in: encoder)
    }

    private func drawCrease(
        _ hinge: Line2D,
        projection: Projection,
        size: CGSize,
        in encoder: any MTLRenderCommandEncoder
    ) {
        let extent = max(projection.bounds.width, projection.bounds.height) * 2
        let start = projection.screenPoint(Point2D(
            x: hinge.point.x - hinge.direction.x * extent,
            y: hinge.point.y - hinge.direction.y * extent
        ))
        let end = projection.screenPoint(Point2D(
            x: hinge.point.x + hinge.direction.x * extent,
            y: hinge.point.y + hinge.direction.y * extent
        ))
        let deltaX = end.x - start.x
        let deltaY = end.y - start.y
        let length = hypot(deltaX, deltaY)
        guard length > 0 else { return }
        let normal = CGPoint(x: -deltaY / length * 0.7, y: deltaX / length * 0.7)
        let screenPoints = [
            CGPoint(x: start.x + normal.x, y: start.y + normal.y),
            CGPoint(x: start.x - normal.x, y: start.y - normal.y),
            CGPoint(x: end.x - normal.x, y: end.y - normal.y),
            CGPoint(x: end.x + normal.x, y: end.y + normal.y),
        ]
        let vertices = triangulatedVertices(
            points: screenPoints.map { clipPoint($0, size: size) },
            textureCoordinates: [SIMD2<Float>](repeating: .zero, count: 4),
            color: SIMD4(0, 0, 0, 0.18),
            light: 1,
            mode: .solid
        )
        draw(vertices, primitive: .triangle, texture: textureCache.paper, in: encoder)
    }

    private func makeItem(input: FaceInput, frame: RenderFrame, projection: Projection) -> RenderItem {
        let fold = frame.fold.map { FoldProjection(fold: $0, moving: input.moving) }
        var depth = 0.0
        let vertices = input.face.polygon.vertices.map { local in
            let folded = fold?.project(local) ?? FoldedPoint(local: local, depth: 0)
            depth += folded.depth
            let screen = projection.screenPoint(folded.local)
            return ProjectedVertex(
                screen: screen,
                clip: clipPoint(screen, size: projection.canvasSize),
                textureCoordinate: projection.textureCoordinate(local)
            )
        }
        let side = fold?.viewingBack == true ? input.face.visibleSide.toggled : input.face.visibleSide
        return RenderItem(
            vertices: vertices,
            visibleSide: side,
            layer: fold?.renderLayer(input.face.layer, frame: frame) ?? input.face.layer,
            depth: depth / Double(max(vertices.count, 1)),
            light: diffuseLight(fold?.visibleNormal ?? SIMD3(0, 0, 1))
        )
    }

    private func diffuseLight(_ normal: SIMD3<Double>) -> Float {
        let light = SIMD3<Double>(-0.35, -0.25, 0.9)
        let lightLength = sqrt(light.x * light.x + light.y * light.y + light.z * light.z)
        let normalLength = sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z)
        guard lightLength > 0, normalLength > 0 else { return 1 }
        let dot = max(0, min(1, (normal.x * light.x + normal.y * light.y + normal.z * light.z) / (lightLength * normalLength)))
        return Float((1 - (1 - dot) * 0.28) * (1 + dot * 0.1))
    }

    private func triangulatedVertices(
        points: [SIMD2<Float>],
        textureCoordinates: [SIMD2<Float>],
        color: SIMD4<Float>,
        light: Float,
        mode: FragmentMode
    ) -> [MetalVertex] {
        guard points.count >= 3, points.count == textureCoordinates.count else { return [] }
        let indices = triangleIndices(for: points)
        return indices.map { vertexIndex in
            MetalVertex(
                position: points[vertexIndex],
                textureCoordinate: textureCoordinates[vertexIndex],
                color: color,
                light: light,
                mode: mode
            )
        }
    }

    private func triangleIndices(for points: [SIMD2<Float>]) -> [Int] {
        guard points.count >= 3 else { return [] }
        if isConvex(points) { return fanIndices(count: points.count) }

        let counterClockwise = signedArea(points) > 0
        var remaining = Array(points.indices)
        var result: [Int] = []
        while remaining.count > 3 {
            var clippedEar = false
            for position in remaining.indices {
                let previous = remaining[(position + remaining.count - 1) % remaining.count]
                let current = remaining[position]
                let next = remaining[(position + 1) % remaining.count]
                let cross = crossProduct(points[previous], points[current], points[next])
                guard counterClockwise ? cross > 0 : cross < 0 else { continue }
                let containsVertex = remaining.contains { candidate in
                    guard candidate != previous, candidate != current, candidate != next else { return false }
                    return point(points[candidate], isInside: points[previous], points[current], points[next])
                }
                guard !containsVertex else { continue }
                result.append(contentsOf: [previous, current, next])
                remaining.remove(at: position)
                clippedEar = true
                break
            }
            guard clippedEar else { return fanIndices(count: points.count) }
        }
        result.append(contentsOf: remaining)
        return result
    }

    private func fanIndices(count: Int) -> [Int] {
        var indices: [Int] = []
        for index in 1..<(count - 1) {
            indices.append(contentsOf: [0, index, index + 1])
        }
        return indices
    }

    private func isConvex(_ points: [SIMD2<Float>]) -> Bool {
        var direction: Float = 0
        for index in points.indices {
            let cross = crossProduct(
                points[index],
                points[(index + 1) % points.count],
                points[(index + 2) % points.count]
            )
            guard abs(cross) > .ulpOfOne else { continue }
            if direction == 0 { direction = cross }
            if cross * direction < 0 { return false }
        }
        return true
    }

    private func signedArea(_ points: [SIMD2<Float>]) -> Float {
        points.indices.reduce(0) { area, index in
            let next = points[(index + 1) % points.count]
            return area + points[index].x * next.y - next.x * points[index].y
        }
    }

    private func crossProduct(
        _ first: SIMD2<Float>,
        _ second: SIMD2<Float>,
        _ third: SIMD2<Float>
    ) -> Float {
        (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
    }

    private func point(
        _ point: SIMD2<Float>,
        isInside first: SIMD2<Float>,
        _ second: SIMD2<Float>,
        _ third: SIMD2<Float>
    ) -> Bool {
        let firstCross = crossProduct(first, second, point)
        let secondCross = crossProduct(second, third, point)
        let thirdCross = crossProduct(third, first, point)
        let hasNegative = firstCross < 0 || secondCross < 0 || thirdCross < 0
        let hasPositive = firstCross > 0 || secondCross > 0 || thirdCross > 0
        return !(hasNegative && hasPositive)
    }

    private func draw(
        _ vertices: [MetalVertex],
        primitive: MTLPrimitiveType,
        texture: any MTLTexture,
        in encoder: any MTLRenderCommandEncoder
    ) {
        vertices.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            encoder.setVertexBytes(baseAddress, length: bytes.count, index: 0)
            encoder.setFragmentTexture(texture, index: 0)
            encoder.drawPrimitives(type: primitive, vertexStart: 0, vertexCount: vertices.count)
        }
    }

    private func clipPoint(_ point: CGPoint, size: CGSize) -> SIMD2<Float> {
        SIMD2(Float(point.x / size.width * 2 - 1), Float(1 - point.y / size.height * 2))
    }

    private func bounds(of points: [Point2D]) -> LocalBounds? {
        guard let first = points.first else { return nil }
        return points.dropFirst().reduce(
            LocalBounds(minimumX: first.x, maximumX: first.x, minimumY: first.y, maximumY: first.y)
        ) { bounds, point in
            LocalBounds(
                minimumX: min(bounds.minimumX, point.x), maximumX: max(bounds.maximumX, point.x),
                minimumY: min(bounds.minimumY, point.y), maximumY: max(bounds.maximumY, point.y)
            )
        }
    }

    private func image(from texture: any MTLTexture, scale: CGFloat) throws -> UIImage {
        let bytesPerRow = texture.width * 4
        var bytes = Data(count: bytesPerRow * texture.height)
        bytes.withUnsafeMutableBytes { buffer in
            guard let address = buffer.baseAddress else { return }
            texture.getBytes(
                address,
                bytesPerRow: bytesPerRow,
                from: MTLRegionMake2D(0, 0, texture.width, texture.height),
                mipmapLevel: 0
            )
        }
        guard
            let provider = CGDataProvider(data: bytes as CFData),
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let image = CGImage(
                width: texture.width,
                height: texture.height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: CGBitmapInfo.byteOrder32Little.union(
                    CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
                ),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
            )
        else { throw RenderFrameRendererError.imageCreationFailed }
        return UIImage(cgImage: image, scale: scale, orientation: .up)
    }

    private func color(hex: String) -> SIMD4<Float> {
        let value = hex.drop(while: { $0 == "#" })
        guard value.count == 6 || value.count == 8, let raw = UInt64(value, radix: 16) else {
            return SIMD4(1, 1, 1, 1)
        }
        let red = Float((raw >> (value.count == 8 ? 24 : 16)) & 0xFF) / 255
        let green = Float((raw >> (value.count == 8 ? 16 : 8)) & 0xFF) / 255
        let blue = Float((raw >> (value.count == 8 ? 8 : 0)) & 0xFF) / 255
        let alpha = value.count == 8 ? Float(raw & 0xFF) / 255 : 1
        return SIMD4(red, green, blue, alpha)
    }
}

private struct FaceInput {
    let face: Face
    let moving: Bool
}
private struct RenderItem {
    let vertices: [ProjectedVertex]
    let visibleSide: PaperSide
    let layer: Int
    let depth: Double
    let light: Float
}
private struct ProjectedVertex {
    let screen: CGPoint
    let clip: SIMD2<Float>
    let textureCoordinate: SIMD2<Float>
}
private struct FoldedPoint {
    let local: Point2D
    let depth: Double
}

private struct FoldProjection {
    private let fold: RenderFold
    private let moving: Bool
    private let angle: Double
    private let normal: SIMD3<Double>

    init(fold: RenderFold, moving: Bool) {
        self.fold = fold
        self.moving = moving
        let progress = fold.progress < 0.5
            ? 4 * pow(fold.progress, 3)
            : 1 - pow(-2 * fold.progress + 2, 3) / 2
        angle = progress * .pi * (fold.moving == .positive ? -1 : 1)
        let axis = SIMD3<Double>(fold.hinge.direction.x, fold.hinge.direction.y, 0)
        let sine = sin(angle)
        let cosine = cos(angle)
        normal = SIMD3(axis.y * sine, -axis.x * sine, cosine)
    }

    var viewingBack: Bool { moving && fold.progress > 0.5 }
    var visibleNormal: SIMD3<Double> {
        guard moving else { return SIMD3(0, 0, 1) }
        return viewingBack ? -normal : normal
    }

    func project(_ point: Point2D) -> FoldedPoint {
        guard moving else { return FoldedPoint(local: point, depth: 0) }
        let offsetX = point.x - fold.hinge.point.x
        let offsetY = point.y - fold.hinge.point.y
        let along = offsetX * fold.hinge.direction.x + offsetY * fold.hinge.direction.y
        let distance = offsetX * fold.hinge.normal.x + offsetY * fold.hinge.normal.y
        let x = fold.hinge.point.x + fold.hinge.direction.x * along + fold.hinge.normal.x * distance * cos(angle)
        let y = fold.hinge.point.y + fold.hinge.direction.y * along + fold.hinge.normal.y * distance * cos(angle)
        let depth = distance * sin(angle)
        let perspective = 1 / max(0.1, 1 + depth * 0.0022)
        return FoldedPoint(local: Point2D(x: x * perspective, y: y * perspective), depth: depth)
    }

    func renderLayer(_ sourceLayer: Int, frame: RenderFrame) -> Int {
        guard moving else { return sourceLayer }
        let maximumStationary = frame.fold?.stationaryFaces.map(\.layer).max() ?? 0
        let maximumMoving = frame.fold?.movingFaces.map(\.layer).max() ?? 0
        return maximumStationary + 1 + (viewingBack ? maximumMoving - sourceLayer : sourceLayer)
    }
}

private struct Projection {
    let bounds: LocalBounds
    let canvasSize: CGSize
    private let center: CGPoint
    private let scale: Double
    private let rotation: Double

    init(frame: RenderFrame, bounds: LocalBounds, canvasSize: CGSize) {
        self.bounds = bounds
        self.canvasSize = canvasSize
        scale = min(
            canvasSize.width * 0.82 / max(bounds.width, .leastNonzeroMagnitude),
            canvasSize.height * 0.70 / max(bounds.height, .leastNonzeroMagnitude)
        ) * frame.transform.scale
        center = CGPoint(
            x: canvasSize.width / 2 + frame.transform.center.x * scale,
            y: canvasSize.height / 2 + frame.transform.center.y * scale
        )
        rotation = frame.transform.rotation
    }

    func screenPoint(_ point: Point2D) -> CGPoint {
        let x = point.x - bounds.midX
        let y = point.y - bounds.midY
        return CGPoint(
            x: center.x + (x * cos(rotation) - y * sin(rotation)) * scale,
            y: center.y + (x * sin(rotation) + y * cos(rotation)) * scale
        )
    }

    func textureCoordinate(_ point: Point2D) -> SIMD2<Float> {
        SIMD2(
            Float((point.x - bounds.minimumX) / max(bounds.width, .leastNonzeroMagnitude)),
            Float((point.y - bounds.minimumY) / max(bounds.height, .leastNonzeroMagnitude))
        )
    }
}

private struct LocalBounds {
    let minimumX: Double
    let maximumX: Double
    let minimumY: Double
    let maximumY: Double
    var width: Double { maximumX - minimumX }
    var height: Double { maximumY - minimumY }
    var midX: Double { (minimumX + maximumX) / 2 }
    var midY: Double { (minimumY + maximumY) / 2 }
}

private enum FragmentMode: Float {
    case wood = 0
    case paper = 1
    case solid = 2
}
private struct MetalVertex {
    let position: SIMD2<Float>
    let textureCoordinate: SIMD2<Float>
    let color: SIMD4<Float>
    let light: Float
    let mode: Float

    init(
        position: SIMD2<Float>,
        textureCoordinate: SIMD2<Float>,
        color: SIMD4<Float>,
        light: Float,
        mode: FragmentMode
    ) {
        self.position = position
        self.textureCoordinate = textureCoordinate
        self.color = color
        self.light = light
        self.mode = mode.rawValue
    }
}
