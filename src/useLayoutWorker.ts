// useLayoutWorker.ts
// Vue composable: manages the layout worker lifecycle and scheduling.

import { ref, type Ref } from 'vue'
import type { Beat, Character, WorkerOutput } from './types'

// Vite's ?worker suffix tells it to bundle this file as a Web Worker
import LayoutWorker from './layout.worker.ts?worker'

export function useLayoutWorker(beats: Ref<Beat[]>, characters: Ref<Character[]>) {
  const worker = new LayoutWorker()
  let busy = false
  let pending = false

  function request(canvasHeight: number) {
    if (busy || beats.value.length === 0) {
      pending = true
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

    if (pending) {
      pending = false
      // Re-request with whatever the board height currently is; caller may pass a getter.
      // We use a sentinel so the caller must call request() again themselves.
      pending = false
    }
  }

  function dispose() { worker.terminate() }

  return { request, dispose }
}
