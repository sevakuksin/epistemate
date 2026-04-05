import type { CompactMove, SerializedGame } from "@cv/engine";
import { deserializeGame, findBestMove } from "@cv/engine";

export type NpcWorkerRequest = {
  serialized: SerializedGame;
  timeMs: number;
  maxDepth?: number;
};

export type NpcWorkerResponse = { bestMove: CompactMove | null; score: number } | { error: string };

self.onmessage = (ev: MessageEvent<NpcWorkerRequest>) => {
  try {
    const state = deserializeGame(ev.data.serialized);
    const { move, score } = findBestMove(state, {
      timeMs: ev.data.timeMs,
      maxDepth: ev.data.maxDepth,
    });
    const out: NpcWorkerResponse = { bestMove: move, score };
    self.postMessage(out);
  } catch (e) {
    const out: NpcWorkerResponse = { error: e instanceof Error ? e.message : String(e) };
    self.postMessage(out);
  }
};
