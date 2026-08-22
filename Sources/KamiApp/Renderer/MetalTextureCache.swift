import MetalKit
import UIKit

@MainActor
final class MetalTextureCache {
    let paper: any MTLTexture
    let wood: any MTLTexture

    init(device: any MTLDevice, bundle: Bundle) throws {
        let loader = MTKTextureLoader(device: device)
        paper = try Self.load(named: "paper", loader: loader, device: device, bundle: bundle)
        wood = try Self.load(named: "wood", loader: loader, device: device, bundle: bundle)
    }

    private static func load(
        named name: String,
        loader: MTKTextureLoader,
        device: any MTLDevice,
        bundle: Bundle
    ) throws -> any MTLTexture {
        guard let url = bundle.url(forResource: name, withExtension: "jpg") else {
            throw RenderFrameRendererError.missingTexture(name)
        }
        guard let image = UIImage(contentsOfFile: url.path) else {
            throw RenderFrameRendererError.textureLoadFailed(name)
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let downsampleScale = min(1, 1_024 / max(image.size.width, image.size.height))
        let textureSize = CGSize(
            width: max(1, (image.size.width * downsampleScale).rounded()),
            height: max(1, (image.size.height * downsampleScale).rounded())
        )
        let normalized = UIGraphicsImageRenderer(size: textureSize, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: textureSize))
        }
        guard let cgImage = normalized.cgImage else {
            throw RenderFrameRendererError.textureLoadFailed(name)
        }
        do {
            let texture = try loader.newTexture(
                cgImage: cgImage,
                options: [
                    .SRGB: true,
                    .textureUsage: NSNumber(value: MTLTextureUsage.shaderRead.rawValue),
                    ]
                )
            return texture.pixelFormat == .r8Unorm ? try upload(cgImage, named: name, device: device) : texture
        } catch {
            return try upload(cgImage, named: name, device: device)
        }
    }

    private static func upload(
        _ image: CGImage,
        named name: String,
        device: any MTLDevice
    ) throws -> any MTLTexture {
        let bytesPerRow = image.width * 4
        var bytes = [UInt8](repeating: 0, count: bytesPerRow * image.height)
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
            throw RenderFrameRendererError.textureLoadFailed(name)
        }
        let drewImage = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard
                let address = buffer.baseAddress,
                let context = CGContext(
                    data: address,
                    width: image.width,
                    height: image.height,
                    bitsPerComponent: 8,
                    bytesPerRow: bytesPerRow,
                    space: colorSpace,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                )
            else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        guard drewImage else { throw RenderFrameRendererError.textureLoadFailed(name) }

        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm_srgb,
            width: image.width,
            height: image.height,
            mipmapped: false
        )
        descriptor.storageMode = .shared
        descriptor.usage = .shaderRead
        guard let texture = device.makeTexture(descriptor: descriptor) else {
            throw RenderFrameRendererError.textureLoadFailed(name)
        }
        bytes.withUnsafeBytes { buffer in
            guard let address = buffer.baseAddress else { return }
            texture.replace(
                region: MTLRegionMake2D(0, 0, image.width, image.height),
                mipmapLevel: 0,
                withBytes: address,
                bytesPerRow: bytesPerRow
            )
        }
        return texture
    }
}
