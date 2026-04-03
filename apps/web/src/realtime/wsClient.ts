type ServerEvent =
  | { type: "welcome"; userId: string; serverTime: string }
  | { type: "presence"; onlineUserIds: string[] }
  | { type: "lobby_updated"; reason: string }
  | { type: "game_updated"; gameId: string; reason: string; updatedAt: string }
  | { type: "game_snapshot"; gameId: string; game: any; state: any; reason: string }
  | { type: "error"; message: string }
  | { type: "ws_connected" }
  | { type: "ws_disconnected" };

type ClientEvent =
  | { type: "subscribe_game"; gameId: string }
  | { type: "unsubscribe_game"; gameId: string }
  | { type: "sync_game"; gameId: string }
  | { type: "ping" };

type Listener = (event: ServerEvent) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private desiredGameSubs = new Set<string>();
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private started = false;

  private emit(event: ServerEvent): void {
    for (const l of this.listeners) l(event);
  }

  addListener(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  stop(): void {
    this.started = false;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempt = 0;
  }

  subscribeGame(gameId: string): () => void {
    this.desiredGameSubs.add(gameId);
    this.send({ type: "subscribe_game", gameId });
    return () => {
      this.desiredGameSubs.delete(gameId);
      this.send({ type: "unsubscribe_game", gameId });
    };
  }

  requestGameSync(gameId: string): void {
    this.send({ type: "sync_game", gameId });
  }

  private send(event: ClientEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  private connect(): void {
    if (!this.started) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      for (const gameId of this.desiredGameSubs) {
        this.send({ type: "subscribe_game", gameId });
      }
      this.emit({ type: "ws_connected" });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as ServerEvent;
        if (!msg || typeof msg !== "object" || !("type" in msg)) return;
        this.emit(msg);
      } catch {
        // ignore bad payloads
      }
    };

    this.ws.onclose = () => {
      this.emit({ type: "ws_disconnected" });
      this.ws = null;
      if (!this.started) return;
      const delay = Math.min(10000, 500 * Math.pow(2, this.reconnectAttempt));
      this.reconnectAttempt += 1;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    };

    this.ws.onerror = () => {
      // handled by close/retry
    };
  }
}

export const wsClient = new WsClient();
