/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight Zero-Dependency JSON-RPC 2.0 Framing & Transport.
 * Conforms to JSON-RPC 2.0 and LSP wire transport specifications.
 */

import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export class JsonRpcConnection extends EventEmitter {
  private inStream?: Readable;
  private outStream?: Writable;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(inStream?: Readable, outStream?: Writable) {
    super();
    this.inStream = inStream;
    this.outStream = outStream;

    if (this.inStream) {
      this.inStream.on("data", (chunk: Buffer) => this.handleData(chunk));
    }
  }

  public handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEndIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerEndIndex === -1) {
        break; // Wait for more data
      }

      const headerText = this.buffer.subarray(0, headerEndIndex).toString("utf-8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        // Corrupted header, skip past \r\n\r\n
        this.buffer = this.buffer.subarray(headerEndIndex + 4);
        continue;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const messageStartIndex = headerEndIndex + 4;
      const messageEndIndex = messageStartIndex + contentLength;

      if (this.buffer.length < messageEndIndex) {
        break; // Message payload incomplete, wait for more data
      }

      const payload = this.buffer.subarray(messageStartIndex, messageEndIndex).toString("utf-8");
      this.buffer = this.buffer.subarray(messageEndIndex);

      try {
        const msg = JSON.parse(payload) as JsonRpcMessage;
        this.emit("message", msg);
      } catch (err) {
        this.emit("error", err);
      }
    }
  }

  public sendMessage(msg: JsonRpcMessage): void {
    const json = JSON.stringify(msg);
    const byteLength = Buffer.byteLength(json, "utf-8");
    const frame = `Content-Length: ${byteLength}\r\n\r\n${json}`;

    if (this.outStream) {
      this.outStream.write(frame);
    }
    this.emit("write", frame);
  }

  public sendResponse(id: number | string, result: unknown): void {
    this.sendMessage({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  public sendError(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    this.sendMessage({
      jsonrpc: "2.0",
      id,
      error: { code, message, data },
    });
  }

  public sendNotification(method: string, params?: unknown): void {
    this.sendMessage({
      jsonrpc: "2.0",
      method,
      params,
    });
  }
}
