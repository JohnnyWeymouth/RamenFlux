<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useLayoutWorker } from './useLayoutWorker'
import type { Beat, Character, RenderedNode, ComputedPath } from './types'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const characters  = ref<Character[]>([])
const beats       = ref<Beat[]>([])
const trashed     = ref<Beat[]>([])
const activeId    = ref<string | null>(null)
const newTitle    = ref('')
const newCharName = ref('')
const charToAdd   = ref('')

const boardEl   = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const COLOR_PALETTE = ['#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#ef4444', '#10b981']

// ---------------------------------------------------------------------------
// Layout worker
// ---------------------------------------------------------------------------

const { request: requestLayout, dispose } = useLayoutWorker(beats, characters)
onUnmounted(dispose)

let debounce: ReturnType<typeof setTimeout> | null = null
watch([beats, characters], () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    requestLayout(boardEl.value?.clientHeight ?? 600)
  }, 300)
}, { deep: true })

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

const activeBeat = computed(() => beats.value.find(b => b.id === activeId.value))

const charNames = computed(() => characters.value.map(c => c.name))

const availableChars = computed(() =>
  activeBeat.value
    ? charNames.value.filter(n => !activeBeat.value!.characters.includes(n))
    : []
)

const renderedNodes = computed<RenderedNode[]>(() => {
  const canvasH = boardEl.value?.clientHeight ?? 600
  return [...beats.value]
    .sort((a, b) => a.x - b.x)
    .map(beat => ({
      ...beat,
      y: beat.y ?? canvasH / 2,
      radius: 12 + ((beat.importance ?? 3) - 1) * 5,
    }))
})

const computedPaths = computed<ComputedPath[]>(() => {
  // Map each character to their nodes in x-order
  const charNodeMap = new Map<string, RenderedNode[]>()
  for (const char of characters.value) {
    charNodeMap.set(
      char.name,
      renderedNodes.value.filter(n => n.characters.includes(char.name)).sort((a, b) => a.x - b.x)
    )
  }

  // Build consistent per-segment ordering so color bands never cross.
  // For each directed segment (prevNode → currNode), sort shared characters
  const charOrderAt = new Map<string, string[]>()
  const sortedNodes = [...renderedNodes.value].sort((a, b) => a.x - b.x)

  for (const node of sortedNodes) {
    const charsHere = node.characters

    const scoreOf: Record<string, number> = {}
    for (const charName of charsHere) {
      const charNodes = charNodeMap.get(charName) ?? []
      const idx = charNodes.findIndex(n => n.id === node.id)

      // Incoming y: effective y of this character at its previous node
      let inY: number | null = null
      if (idx > 0) {
        const prevNode = charNodes[idx - 1]
        const prevOrder = charOrderAt.get(prevNode.id) ?? [...prevNode.characters]
        const pi = prevOrder.indexOf(charName)
        const prevOff = prevOrder.length > 1 ? (pi - (prevOrder.length - 1) / 2) * 8 : 0
        inY = prevNode.y + prevOff
      }

      // Outgoing y: raw y of the next node (not yet ordered, so use node.y as best estimate)
      let outY: number | null = null
      if (idx < charNodes.length - 1) {
        outY = charNodes[idx + 1].y
      }

      // Average whatever signals we have; fall back to current node y
      if (inY !== null && outY !== null) scoreOf[charName] = (inY + outY) / 2
      else if (inY !== null) scoreOf[charName] = inY
      else if (outY !== null) scoreOf[charName] = outY
      else scoreOf[charName] = node.y
    }

    // Sort by score; tiebreak by color string for determinism
    const sorted = [...charsHere].sort((a, b) => {
      const diff = scoreOf[a] - scoreOf[b]
      if (Math.abs(diff) > 0.001) return diff
      const colA = characters.value.find(c => c.name === a)?.color ?? a
      const colB = characters.value.find(c => c.name === b)?.color ?? b
      return colA < colB ? -1 : colA > colB ? 1 : 0
    })
    charOrderAt.set(node.id, sorted)
  }

  return characters.value.flatMap(char => {
    const nodes = charNodeMap.get(char.name) ?? []
    if (nodes.length < 1) return []

    let d = ''
    for (let i = 0; i < nodes.length; i++) {
      const curr = nodes[i]
      const order = charOrderAt.get(curr.id)!
      const charIdx = order.indexOf(char.name)
      const yOffset = order.length > 1 ? (charIdx - (order.length - 1) / 2) * 8 : 0
      const tx = curr.x, ty = curr.y + yOffset

      if (i === 0) {
        d += `M ${tx} ${ty}`
      } else {
        const prev = nodes[i - 1]
        const prevOrder = charOrderAt.get(prev.id)!
        const prevIdx = prevOrder.indexOf(char.name)
        const prevOffset = prevOrder.length > 1 ? (prevIdx - (prevOrder.length - 1) / 2) * 8 : 0
        const sx = prev.x, sy = prev.y + prevOffset
        const tension = 0.15
        const cp1x = sx + (tx - sx) * tension
        const cp2x = tx - (tx - sx) * tension
        d += ` C ${cp1x} ${sy}, ${cp2x} ${ty}, ${tx} ${ty}`
      }
    }
    return [{ character: char.name, d, color: char.color }]
  })
})

function nodeGradient(node: RenderedNode): string {
  const colors = node.characters.map(name => characters.value.find(c => c.name === name)?.color ?? '#94a3b8')
  if (colors.length === 0) return '#0f172a'
  if (colors.length === 1) return colors[0]
  const step = 100 / colors.length
  const stops = colors.map((col, i) => `${col} ${i * step}% ${(i + 1) * step}%`).join(', ')
  return `conic-gradient(${stops})`
}

// ---------------------------------------------------------------------------
// Beat actions
// ---------------------------------------------------------------------------

function addBeat() {
  if (!newTitle.value.trim()) return
  const id = crypto.randomUUID()
  beats.value.push({ id, x: 180, title: newTitle.value.trim(), characters: [], importance: 3, details: '' })
  activeId.value = id
  newTitle.value = ''
}

function deleteBeat(id: string) {
  const idx = beats.value.findIndex(b => b.id === id)
  if (idx === -1) return
  trashed.value.push(...beats.value.splice(idx, 1))
  if (activeId.value === id) activeId.value = beats.value[0]?.id ?? null
}

function restoreBeat(id: string) {
  const idx = trashed.value.findIndex(b => b.id === id)
  if (idx === -1) return
  const [beat] = trashed.value.splice(idx, 1)
  beats.value.push(beat)
  activeId.value = beat.id
}

// ---------------------------------------------------------------------------
// Character actions
// ---------------------------------------------------------------------------

function addGlobalChar() {
  const name = newCharName.value.trim()
  if (!name || charNames.value.includes(name)) return
  const color = COLOR_PALETTE[characters.value.length % COLOR_PALETTE.length]
  characters.value.push({ name, color })
  if (activeBeat.value) activeBeat.value.characters.push(name)
  newCharName.value = ''
}

function addCharToBeat() {
  if (!charToAdd.value || !activeBeat.value) return
  activeBeat.value.characters.push(charToAdd.value)
  charToAdd.value = ''
}

function removeCharFromBeat(name: string) {
  if (activeBeat.value) {
    activeBeat.value.characters = activeBeat.value.characters.filter(c => c !== name)
  }
}

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

const drag = ref<{ id: string; startMouseX: number; startNodeX: number } | null>(null)

function startDrag(e: MouseEvent, id: string) {
  const beat = beats.value.find(b => b.id === id)
  if (beat) drag.value = { id, startMouseX: e.clientX, startNodeX: beat.x }
}

function onDrag(e: MouseEvent) {
  if (!drag.value || !boardEl.value) return
  const beat = beats.value.find(b => b.id === drag.value!.id)
  if (!beat) return
  const { width } = boardEl.value.getBoundingClientRect()
  beat.x = Math.max(30, Math.min(drag.value.startNodeX + e.clientX - drag.value.startMouseX, width - 30))
}

function endDrag() { drag.value = null }

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

function exportData() {
  const json = JSON.stringify({ characters: characters.value, beats: beats.value }, null, 2)
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/json;charset=utf-8,' + encodeURIComponent(json),
    download: 'ramenflux_export.json',
  })
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function importClick() { fileInput.value?.click() }

function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target?.result as string)
      if (parsed.characters && parsed.beats) {
        characters.value = parsed.characters
        beats.value = parsed.beats
        activeId.value = beats.value[0]?.id ?? null
      } else {
        alert('Invalid export format.')
      }
    } catch {
      alert('Could not read file.')
    }
  }
  reader.readAsText(file)
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="header">
    <div>
      <h1>RamenFlux</h1>
      <p>Drag nodes horizontally. Connect characters across beats.</p>
    </div>
    <div class="header-actions">
      <button class="btn-io" @click="exportData">📤 Export JSON</button>
      <button class="btn-io" @click="importClick">📥 Import JSON</button>
      <input ref="fileInput" type="file" accept=".json" style="display:none" @change="onImport" />
    </div>
  </div>

  <div class="layout">
    <!-- Canvas -->
    <div
      ref="boardEl"
      class="board"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @mouseleave="endDrag"
    >
      <p v-if="!renderedNodes.length" class="board-empty">
        Canvas is empty — add a node from the panel.
      </p>

      <svg class="board-svg">
        <!-- Grid lines -->
        <line
          v-for="i in 20" :key="i"
          :x1="i * 80" y1="0" :x2="i * 80" y2="100%"
          stroke="#f1f5f9" stroke-width="1"
        />
        <!-- Character paths -->
        <path
          v-for="path in computedPaths" :key="path.character"
          :d="path.d" :stroke="path.color"
          fill="none" stroke-width="2.5" stroke-linecap="round"
        />
      </svg>

      <!-- Beat nodes -->
      <div
        v-for="node in renderedNodes" :key="node.id"
        class="node"
        :class="{ active: activeId === node.id }"
        :style="{
          left: node.x + 'px',
          top: node.y + 'px',
          width: node.radius * 2 + 'px',
          height: node.radius * 2 + 'px',
          background: nodeGradient(node),
        }"
        @mousedown="startDrag($event, node.id)"
        @click.stop="activeId = node.id"
      >
        <span class="node-label">{{ node.title }}</span>
      </div>
    </div>

    <!-- Side panel -->
    <aside class="panel">

      <!-- Add beat -->
      <section class="card">
        <h4>New Node</h4>
        <input v-model="newTitle" placeholder="Node title..." @keyup.enter="addBeat" />
        <button class="btn-action" @click="addBeat">Add to Board</button>
      </section>

      <!-- Active beat editor -->
      <section v-if="activeBeat" class="card">
        <div class="card-header">
          <div>
            <span class="label-tag">Active Node</span>
            <h3>{{ activeBeat.title }}</h3>
          </div>
          <button class="btn-icon" title="Delete node" @click="deleteBeat(activeBeat.id)">🗑️</button>
        </div>

        <label class="field-label">Importance</label>
        <input type="range" min="1" max="5" step="1" v-model.number="activeBeat.importance" />
        <div class="range-labels">
          <span>Less</span><span>More</span>
        </div>

        <label class="field-label" style="margin-top:12px">Details</label>
        <textarea v-model="activeBeat.details" placeholder="Scene notes, location, context…" />

        <h5>Characters present</h5>
        <p v-if="!activeBeat.characters.length" class="muted">None yet.</p>
        <div v-for="name in activeBeat.characters" :key="name" class="char-row">
          <span>{{ name }}</span>
          <button class="btn-icon" @click="removeCharFromBeat(name)">❌</button>
        </div>

        <select v-if="availableChars.length" v-model="charToAdd" @change="addCharToBeat" style="margin-top:8px">
          <option value="" disabled selected>➕ Add character…</option>
          <option v-for="c in availableChars" :key="c" :value="c">{{ c }}</option>
        </select>
      </section>

      <!-- Trash -->
      <section class="card">
        <h4>🗑️ Trash</h4>
        <p v-if="!trashed.length" class="muted">Empty.</p>
        <div v-for="b in trashed" :key="b.id" class="trash-row">
          <span class="trash-title">{{ b.title }}</span>
          <button class="btn-restore" @click="restoreBeat(b.id)">↩️ Restore</button>
        </div>
      </section>

      <!-- Character registry -->
      <section class="card">
        <h4>👥 Characters</h4>
        <div v-for="c in characters" :key="c.name" class="char-entry">
          <input
            type="color"
            :value="c.color"
            @input="c.color = ($event.target as HTMLInputElement).value"
            style="width:22px;height:22px;border:none;border-radius:50%;padding:0;cursor:pointer;background:none;flex-shrink:0;"
          />
          <span>{{ c.name }}</span>
        </div>
        <div class="divider" />
        <input v-model="newCharName" placeholder="New character name" />
        <button class="btn-action" style="background:#475569" @click="addGlobalChar">Register</button>
      </section>

    </aside>
  </div>
</template>
