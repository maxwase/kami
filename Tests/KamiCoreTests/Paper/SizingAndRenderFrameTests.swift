import KamiCore
import Testing

struct SizingTests {
    @Test("A4 and square presets retain their intended ratios")
    func presetsHaveExpectedRatios() {
        #expect(PaperAspectRatio.a4.value == 210.0 / 297.0)
        #expect(PaperAspectRatio.square.value == 1)
    }

    @Test("Custom positive finite dimensions form a ratio")
    func customDimensionsFormRatio() throws {
        let ratio = try PaperAspectRatio(width: 16, height: 9)

        #expect(ratio.value == 16.0 / 9.0)
    }

    @Test(arguments: [
        (width: 0.0, height: 1.0),
        (width: 1.0, height: 0.0),
        (width: .infinity, height: 1.0),
        (width: 1.0, height: .nan),
    ])
    func malformedCustomDimensionsAreRejected(dimensions: (width: Double, height: Double)) {
        #expect(throws: PaperValidationError.invalidDimensions) {
            try PaperAspectRatio(width: dimensions.width, height: dimensions.height)
        }
    }

    @Test("A portrait viewport fits A4 within the safe content area")
    func portraitFitRespectsSafeArea() throws {
        let placement = try paperPlacement(
            aspectRatio: .a4,
            in: ViewportSize(width: 390, height: 844),
            safeArea: PaperInsets(top: 59, leading: 0, bottom: 34, trailing: 0),
            margin: 16
        )

        #expect(placement.size.x == 390 - 32)
        #expect(placement.size.y == (390 - 32) / PaperAspectRatio.a4.value)
        #expect(placement.center == Point2D(x: 195, y: (59 + 16 + 844 - 34 - 16) / 2))
    }

    @Test("A landscape viewport limits A4 by height")
    func landscapeFitUsesAvailableHeight() throws {
        let placement = try paperPlacement(
            aspectRatio: .a4,
            in: ViewportSize(width: 844, height: 390),
            safeArea: .zero,
            margin: 16
        )

        #expect(placement.size.y == 390 - 32)
        #expect(placement.size.x == (390 - 32) * PaperAspectRatio.a4.value)
        #expect(placement.center == Point2D(x: 422, y: 195))
    }
}

struct RenderFrameTests {
    @Test("A render frame freezes paper, style, transform, hinge, and outline state")
    func frameCapturesImmutableRenderInputs() throws {
        let paper = try Paper.rectangle(
            id: PaperID(rawValue: 1),
            faceID: FaceID(rawValue: 2),
            style: .white,
            center: Point2D(x: 13, y: 21),
            width: 210,
            height: 297
        )
        let line = try Line2D(point: Point2D(x: 0, y: 4), direction: Point2D(x: 0, y: 1))
        let animation = FoldAnimation(
            paperID: paper.id,
            progress: 0.4,
            line: line,
            moving: .positive,
            stationaryFaces: paper.faces,
            movingFaces: paper.faces,
            foldedLayer: 1
        )

        let frame = RenderFrame(paper: paper, animation: animation, outlineEnabled: false)

        #expect(frame.faces == paper.faces)
        #expect(frame.style == paper.style)
        #expect(frame.transform.center == paper.center)
        #expect(frame.transform.rotation == paper.rotation)
        #expect(frame.transform.scale == paper.scale)
        #expect(frame.hinge == line)
        #expect(frame.foldProgress == 0.4)
        #expect(frame.outlineEnabled == false)
    }
}
