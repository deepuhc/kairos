export interface Transport {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
  close(): void;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private messageHandler?: (data: string) => void;
  private closeHandler?: () => void;
  private errorHandler?: (error: Error) => void;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => {
      this.messageHandler?.(event.data);
    };
    this.ws.onclose = () => {
      this.closeHandler?.();
    };
    this.ws.onerror = (event) => {
      this.errorHandler?.(new Error(`WebSocket error: ${event}`));
    };
  }

  static async connect(url: string): Promise<WebSocketTransport> {
    const transport = new WebSocketTransport(url);
    return new Promise((resolve, reject) => {
      transport.ws.onopen = () => {
        transport.ws.onerror = (event) => {
          transport.errorHandler?.(new Error(`WebSocket error: ${event}`));
        };
        resolve(transport);
      };
      transport.ws.onerror = () => reject(new Error(`Failed to connect to ${url}`));
    });
  }

  send(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  close(): void {
    this.ws.close();
  }
}
