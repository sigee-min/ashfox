export class ByteAccumulator {
  private storage = Buffer.alloc(0);
  private readOffset = 0;
  private writeOffset = 0;

  get length(): number {
    return this.writeOffset - this.readOffset;
  }

  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    const activeLength = this.length;
    const required = activeLength + chunk.length;
    if (required > this.storage.length) {
      let capacity = Math.max(1024, this.storage.length);
      while (capacity < required) capacity *= 2;
      const expanded = Buffer.allocUnsafe(capacity);
      this.storage.copy(expanded, 0, this.readOffset, this.writeOffset);
      this.storage = expanded;
      this.readOffset = 0;
      this.writeOffset = activeLength;
    } else if (this.storage.length - this.writeOffset < chunk.length) {
      this.storage.copy(this.storage, 0, this.readOffset, this.writeOffset);
      this.readOffset = 0;
      this.writeOffset = activeLength;
    }
    chunk.copy(this.storage, this.writeOffset);
    this.writeOffset += chunk.length;
  }

  indexOf(value: string): number {
    return this.storage.subarray(this.readOffset, this.writeOffset).indexOf(value);
  }

  view(start: number, end: number): Uint8Array {
    const normalizedStart = Math.min(Math.max(0, start), this.length);
    const normalizedEnd = Math.min(Math.max(normalizedStart, end), this.length);
    const from = this.readOffset + normalizedStart;
    const to = this.readOffset + normalizedEnd;
    return this.storage.subarray(from, to);
  }

  take(length: number): Buffer {
    const count = Math.min(Math.max(0, length), this.length);
    const result = Buffer.from(this.storage.subarray(this.readOffset, this.readOffset + count));
    this.consume(count);
    return result;
  }

  consume(length: number): void {
    const count = Math.min(Math.max(0, length), this.length);
    this.readOffset += count;
    if (this.readOffset === this.writeOffset) {
      this.readOffset = 0;
      this.writeOffset = 0;
      if (this.storage.length > 65_536) {
        this.storage = Buffer.alloc(0);
      }
    }
  }

  clear(): void {
    this.storage = Buffer.alloc(0);
    this.readOffset = 0;
    this.writeOffset = 0;
  }
}
