// useLayoutWorker.ts
// Vue composable: manages the layout worker lifecycle and scheduling.

import { ref, type Ref } from 'vue'
import type { Beat, Character, WorkerOutput } from './types'

// Vite's ?worker suffix tells it to bundle this file as a Web Worker
import LayoutWorker from './layout.worker.ts?worker'

export function useLayoutWorker(beats: Ref<Beat[]>, characters: Ref<Character[]>) {
  const worker = new LayoutWorker()
  let busy = false
  // Height of the most recent request that arrived while we were busy, if
  // any — re-issued as soon as the in-flight run finishes. (Previously this
  // was dropped entirely: a change made mid-run never triggered a follow-up
  // layout pass.)
  let pendingHeight: number | null = null

  function request(canvasHeight: number) {
    if (busy || beats.value.length === 0) {
      pendingHeight = canvasHeight
      return
    }
    busy = true
    worker.postMessage({
      beats: JSON.parse(JSON.stringify(beats.value)),
      characters: JSON.parse(JSON.stringify(characters.value)),
      canvasHeight,
    })
  }

  worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
    busy = false
    const result = e.data

    if (result.better) {
      for (const beat of beats.value) {
        if (result.layout[beat.id] !== undefined) {
          beat.y = result.layout[beat.id]
        }
      }
    }

    if (pendingHeight !== null) {
      const h = pendingHeight
      pendingHeight = null
      request(h)
    }
  }

  function dispose() { worker.terminate() }

  return { request, dispose }
}
