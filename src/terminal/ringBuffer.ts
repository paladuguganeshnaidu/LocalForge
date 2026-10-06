export class RingBuffer {
  private chunks: Buffer[] = [];
  private currentBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes = 2 * 1024 * 1024) {
    // Default 2MB limit
    this.maxBytes = Math.max(1, maxBytes);
  }

  public write(data: string | Buffer): void {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    if (buf.length === 0) return;

    this.chunks.push(buf);
    this.currentBytes += buf.length;

    // Evict oldest chunks while exceeding maxBytes
    while (this.currentBytes > this.maxBytes && this.chunks.length > 0) {
      const excess = this.currentBytes - this.maxBytes;
      const oldest = this.chunks[0];

      if (oldest.length <= excess) {
        this.chunks.shift();
        this.currentBytes -= oldest.length;
      } else {
        // Slice oldest buffer
        this.chunks[0] = oldest.subarray(excess);
        this.currentBytes -= excess;
        break;
      }
    }
  }

  public toString(encoding: BufferEncoding = 'utf-8'): string {
    if (this.chunks.length === 0) return '';
    return Buffer.concat(this.chunks).toString(encoding);
  }

  public getBytesCount(): number {
    return this.currentBytes;
  }

  public getMaxBytes(): number {
    return this.maxBytes;
  }

  public clear(): void {
    this.chunks = [];
    this.currentBytes = 0;
  }
}
