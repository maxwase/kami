enum MetalShaderSource {
    static let source = #"""
    #include <metal_stdlib>
    using namespace metal;

    struct PaperVertex {
        float2 position;
        float2 textureCoordinate;
        float4 color;
        float light;
        float mode;
    };

    struct RasterizedVertex {
        float4 position [[position]];
        float2 textureCoordinate;
        float4 color;
        float light;
        float mode;
    };

    vertex RasterizedVertex paperVertex(
        const device PaperVertex *vertices [[buffer(0)]],
        uint vertexID [[vertex_id]]
    ) {
        PaperVertex source = vertices[vertexID];
        RasterizedVertex output;
        output.position = float4(source.position, 0, 1);
        output.textureCoordinate = source.textureCoordinate;
        output.color = source.color;
        output.light = source.light;
        output.mode = source.mode;
        return output;
    }

    fragment half4 paperFragment(
        RasterizedVertex input [[stage_in]],
        texture2d<float> texture [[texture(0)]]
    ) {
        constexpr sampler textureSampler(filter::linear, address::repeat);
        float mode = round(input.mode);
        if (mode == 2) {
            return half4(input.color);
        }

        float4 sample = texture.sample(textureSampler, input.textureCoordinate);
        if (mode == 0) {
            float vignette = smoothstep(0.15, 0.82, distance(input.textureCoordinate, float2(0.5, 0.55)));
            float scanline = fmod(input.position.y, 18) < 3.6 ? 0.985 : 1.0;
            return half4(float4(sample.rgb * scanline * (1 - vignette * 0.22), 1));
        }

        float3 paper = sample.rgb * input.color.rgb * 0.9;
        return half4(float4(clamp(paper * input.light, 0.0, 1.0), input.color.a));
    }
    """#
}
