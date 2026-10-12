interface SubtleCrypto {
  timingSafeEqual(
    a: ArrayBufferView | ArrayBuffer,
    b: ArrayBufferView | ArrayBuffer,
  ): boolean;
}
