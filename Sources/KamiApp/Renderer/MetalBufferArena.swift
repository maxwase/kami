import Metal

@MainActor
final class MetalBufferArena {
    private let device: any MTLDevice
    private var vertexBuffer: (any MTLBuffer)?
    private var indexBuffer: (any MTLBuffer)?
    private var vertexCapacity = 0
    private var indexCapacity = 0
    private var vertexOffset = 0
    private var indexOffset = 0

    init(device: any MTLDevice) {
        self.device = device
    }

    func beginFrame() {
        vertexOffset = 0
        indexOffset = 0
    }

    func encode(
        vertices: [MetalVertex],
        indices: [UInt32]? = nil,
        primitive: MTLPrimitiveType,
        texture: any MTLTexture,
        in encoder: any MTLRenderCommandEncoder
    ) throws {
        guard vertices.isEmpty == false else { return }
        let vertexAllocation = try allocateVertices(vertices)
        encoder.setVertexBuffer(vertexAllocation.buffer, offset: vertexAllocation.offset, index: 0)
        encoder.setFragmentTexture(texture, index: 0)

        if let indices, indices.isEmpty == false {
            let indexAllocation = try allocateIndices(indices)
            encoder.drawIndexedPrimitives(
                type: primitive,
                indexCount: indices.count,
                indexType: .uint32,
                indexBuffer: indexAllocation.buffer,
                indexBufferOffset: indexAllocation.offset
            )
        } else {
            encoder.drawPrimitives(type: primitive, vertexStart: 0, vertexCount: vertices.count)
        }
    }

    private func allocateVertices(_ vertices: [MetalVertex]) throws -> BufferAllocation {
        let length = vertices.count * MemoryLayout<MetalVertex>.stride
        let allocation = try allocate(
            length: length,
            buffer: &vertexBuffer,
            capacity: &vertexCapacity,
            offset: &vertexOffset
        )
        vertices.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            allocation.buffer.contents().advanced(by: allocation.offset).copyMemory(
                from: baseAddress,
                byteCount: bytes.count
            )
        }
        return allocation
    }

    private func allocateIndices(_ indices: [UInt32]) throws -> BufferAllocation {
        let length = indices.count * MemoryLayout<UInt32>.stride
        let allocation = try allocate(
            length: length,
            buffer: &indexBuffer,
            capacity: &indexCapacity,
            offset: &indexOffset
        )
        indices.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            allocation.buffer.contents().advanced(by: allocation.offset).copyMemory(
                from: baseAddress,
                byteCount: bytes.count
            )
        }
        return allocation
    }

    private func allocate(
        length: Int,
        buffer: inout (any MTLBuffer)?,
        capacity: inout Int,
        offset: inout Int
    ) throws -> BufferAllocation {
        let alignment = 256
        var alignedOffset = (offset + alignment - 1) / alignment * alignment
        if buffer == nil || alignedOffset + length > capacity {
            let doubledCapacity = capacity.multipliedReportingOverflow(by: 2)
            let growth = doubledCapacity.overflow ? length : max(length, doubledCapacity.partialValue)
            let newCapacity = max(4_096, growth)
            guard let newBuffer = device.makeBuffer(length: newCapacity, options: .storageModeShared) else {
                throw RenderFrameRendererError.bufferCreationFailed
            }
            buffer = newBuffer
            capacity = newCapacity
            alignedOffset = 0
        }
        guard let buffer else { throw RenderFrameRendererError.bufferCreationFailed }
        offset = alignedOffset + length
        return BufferAllocation(buffer: buffer, offset: alignedOffset)
    }
}

private struct BufferAllocation {
    let buffer: any MTLBuffer
    let offset: Int
}
