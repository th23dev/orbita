/** Minimal AudioWorklet adapter for the pinned RNNoise WASM C API.
 * No fetch, DOM, or worker globals are available in an AudioWorklet.
 */
type RnnoiseExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  emscripten_stack_init(): void
  __wasm_call_ctors(): void
  rnnoise_get_frame_size(): number
  rnnoise_create(model: number): number
  rnnoise_destroy(state: number): void
  rnnoise_process_frame(state: number, output: number, input: number): number
  malloc(bytes: number): number
  free(pointer: number): void
}

export class NeuralDenoiser {
  private state = 0
  private buffer = 0
  private heap: Float32Array

  private constructor(private api: RnnoiseExports) {
    api.emscripten_stack_init()
    api.__wasm_call_ctors()
    if (api.rnnoise_get_frame_size() !== 480) throw new Error('Invalid RNNoise frame size')
    this.heap = new Float32Array(api.memory.buffer)
    this.state = api.rnnoise_create(0)
    this.buffer = api.malloc(480 * 4)
    if (!this.state || !this.buffer) {
      this.destroy()
      throw new Error('RNNoise allocation failed')
    }
  }

  static async create(binary: ArrayBuffer) {
    let api: RnnoiseExports
    const { instance } = await WebAssembly.instantiate(binary, {
      env: {
        emscripten_memcpy_big: (destination: number, source: number, bytes: number) => {
          new Uint8Array(api.memory.buffer).copyWithin(destination, source, source + bytes)
          return destination
        },
        // One mono state fits in the module's initial memory; never grow on the audio thread.
        emscripten_resize_heap: () => 0,
        __assert_fail: () => {
          throw new Error('RNNoise assertion failed')
        },
      },
    })
    api = instance.exports as RnnoiseExports
    return new NeuralDenoiser(api)
  }

  processFrame(frame: Float32Array) {
    if (!this.state || frame.length !== 480) throw new Error('Invalid RNNoise frame')
    const offset = this.buffer / 4
    this.heap.set(frame, offset)
    const probability = this.api.rnnoise_process_frame(this.state, this.buffer, this.buffer)
    frame.set(this.heap.subarray(offset, offset + 480))
    return probability
  }

  destroy() {
    if (this.state) this.api.rnnoise_destroy(this.state)
    if (this.buffer) this.api.free(this.buffer)
    this.state = this.buffer = 0
  }
}
