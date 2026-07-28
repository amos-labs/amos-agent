import Darwin
import Foundation
import Metal

struct Series {
    let values: [Double]

    func percentile(_ fraction: Double) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let index = max(0, min(sorted.count - 1, Int(ceil(fraction * Double(sorted.count))) - 1))
        return sorted[index]
    }

    var mean: Double {
        values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
    }
}

func elapsedMilliseconds(_ start: UInt64, _ end: UInt64) -> Double {
    Double(end - start) / 1_000_000
}

func clockNow() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds
}

func require(_ condition: Bool, _ message: String) {
    if !condition {
        FileHandle.standardError.write(Data("Calibration failed: \(message)\n".utf8))
        exit(1)
    }
}

func writeAll(_ fd: Int32, _ pointer: UnsafeRawPointer, _ count: Int) {
    var written = 0
    while written < count {
        let result = Darwin.write(fd, pointer.advanced(by: written), count - written)
        require(result > 0, "temporary calibration write failed")
        written += result
    }
}

func readAll(_ fd: Int32, _ pointer: UnsafeMutableRawPointer, _ count: Int) {
    var consumed = 0
    while consumed < count {
        let result = Darwin.read(fd, pointer.advanced(by: consumed), count - consumed)
        require(result > 0, "temporary calibration read failed")
        consumed += result
    }
}

func preadAll(
    _ fd: Int32,
    _ pointer: UnsafeMutableRawPointer,
    _ count: Int,
    _ offset: off_t
) {
    var consumed = 0
    while consumed < count {
        let result = Darwin.pread(
            fd,
            pointer.advanced(by: consumed),
            count - consumed,
            offset + off_t(consumed)
        )
        require(result > 0, "temporary random calibration read failed")
        consumed += result
    }
}

func calibrateStorage() -> [String: Any] {
    let fileSize = 1 * 1024 * 1024 * 1024
    let blockSize = 8 * 1024 * 1024
    let randomReadSize = 4 * 1024
    let path = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("amos-expert-cache-\(UUID().uuidString).bin")
        .path
    let fd = Darwin.open(path, O_RDWR | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR)
    require(fd >= 0, "could not create a temporary storage calibration file")
    defer {
        Darwin.close(fd)
        unlink(path)
    }

    let block = UnsafeMutableRawPointer.allocate(
        byteCount: blockSize,
        alignment: 4096
    )
    defer { block.deallocate() }
    arc4random_buf(block, blockSize)
    for _ in 0..<(fileSize / blockSize) {
        writeAll(fd, block, blockSize)
    }
    require(fsync(fd) == 0, "could not flush the temporary calibration file")
    require(fcntl(fd, F_NOCACHE, 1) == 0, "could not enable uncached file access")

    require(lseek(fd, 0, SEEK_SET) == 0, "could not rewind calibration file")
    let sequentialStart = clockNow()
    for _ in 0..<(fileSize / blockSize) {
        readAll(fd, block, blockSize)
    }
    let sequentialEnd = clockNow()
    let sequentialSeconds = Double(sequentialEnd - sequentialStart) / 1_000_000_000
    let sequentialGiBPerSecond =
        (Double(fileSize) / pow(1024, 3)) / sequentialSeconds

    let randomBuffer = UnsafeMutableRawPointer.allocate(
        byteCount: randomReadSize,
        alignment: 4096
    )
    defer { randomBuffer.deallocate() }
    var randomLatencies: [Double] = []
    let pageCount = fileSize / randomReadSize
    var generator = SystemRandomNumberGenerator()
    for _ in 0..<512 {
        let page = Int.random(in: 0..<pageCount, using: &generator)
        let start = clockNow()
        preadAll(fd, randomBuffer, randomReadSize, off_t(page * randomReadSize))
        randomLatencies.append(elapsedMilliseconds(start, clockNow()))
    }
    let latency = Series(values: randomLatencies)

    return [
        "file_bytes": fileSize,
        "read_gib_s": sequentialGiBPerSecond,
        "range_latency_ms_p50": latency.percentile(0.50),
        "range_latency_ms_p95": latency.percentile(0.95),
    ]
}

func metalCopyMilliseconds(
    queue: MTLCommandQueue,
    source: MTLBuffer,
    destination: MTLBuffer,
    bytes: Int,
    iterations: Int
) -> [Double] {
    var samples: [Double] = []
    for index in 0..<(iterations + 3) {
        guard
            let command = queue.makeCommandBuffer(),
            let blit = command.makeBlitCommandEncoder()
        else {
            require(false, "could not create a Metal blit command")
            return []
        }
        blit.copy(
            from: source,
            sourceOffset: 0,
            to: destination,
            destinationOffset: 0,
            size: bytes
        )
        blit.endEncoding()
        let start = clockNow()
        command.commit()
        command.waitUntilCompleted()
        require(command.status == .completed, "Metal copy did not complete")
        if index >= 3 {
            samples.append(elapsedMilliseconds(start, clockNow()))
        }
    }
    return samples
}

func calibrateMetal() -> [String: Any] {
    guard let device = MTLCreateSystemDefaultDevice() else {
        require(false, "no Metal device is available")
        return [:]
    }
    guard let queue = device.makeCommandQueue() else {
        require(false, "could not create a Metal command queue")
        return [:]
    }
    let transferBytes = 128 * 1024 * 1024
    guard
        let transferSource = device.makeBuffer(
            length: transferBytes,
            options: .storageModeShared
        ),
        let transferDestination = device.makeBuffer(
            length: transferBytes,
            options: .storageModePrivate
        )
    else {
        require(false, "could not allocate Metal transfer buffers")
        return [:]
    }
    memset(transferSource.contents(), 0xA5, transferBytes)
    let transfer = Series(
        values: metalCopyMilliseconds(
            queue: queue,
            source: transferSource,
            destination: transferDestination,
            bytes: transferBytes,
            iterations: 20
        )
    )
    let transferBandwidths = transfer.values.map {
        (Double(transferBytes) / pow(1024, 3)) / ($0 / 1_000)
    }

    let remapEntries = 36 * 4
    let remapBytes = max(4096, remapEntries * MemoryLayout<UInt32>.size)
    guard
        let remapSource = device.makeBuffer(
            length: remapBytes,
            options: .storageModeShared
        ),
        let remapDestination = device.makeBuffer(
            length: remapBytes,
            options: .storageModePrivate
        )
    else {
        require(false, "could not allocate Metal remap buffers")
        return [:]
    }
    let remap = Series(
        values: metalCopyMilliseconds(
            queue: queue,
            source: remapSource,
            destination: remapDestination,
            bytes: remapBytes,
            iterations: 100
        )
    )

    return [
        "device": device.name,
        "transfer_bytes": transferBytes,
        "upload_gib_s_p05": Series(values: transferBandwidths).percentile(0.05),
        "upload_gib_s_p50": Series(values: transferBandwidths).percentile(0.50),
        "upload_ms_p95": transfer.percentile(0.95),
        "remap_proxy_entries": remapEntries,
        "remap_proxy_ms_p95": remap.percentile(0.95),
        "slot_remap_ms_proxy": remap.percentile(0.95) / Double(remapEntries),
        "remap_note": "Small Metal table-copy proxy; replace with runtime slot-remap telemetry in Phase 1.",
    ]
}

let report: [String: Any] = [
    "schema": "amos.expert-cache-host-calibration",
    "version": 1,
    "created_at": ISO8601DateFormatter().string(from: Date()),
    "hardware": [
        "model": ProcessInfo.processInfo.hostName,
        "physical_memory_bytes": ProcessInfo.processInfo.physicalMemory,
        "processor_count": ProcessInfo.processInfo.processorCount,
    ],
    "storage": calibrateStorage(),
    "metal": calibrateMetal(),
]

let data = try JSONSerialization.data(
    withJSONObject: report,
    options: [.prettyPrinted, .sortedKeys]
)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
