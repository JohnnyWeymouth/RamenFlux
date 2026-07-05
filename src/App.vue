<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useLayoutWorker } from './useLayoutWorker'
import type { Beat, Character, RenderedNode, RenderedSegment } from './types'

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

// What the layout actually depends on: each beat's x position and which
// characters touch it, plus which characters exist at all. Deliberately
// excludes `y` (the worker's own output), `title`, `details`, and
// `importance` — none of those affect the layout, and watching `y` in
// particular would mean the worker re-triggering itself on every result it
// writes back (flapping / a feedback loop). Sorted so re-ordering the
// underlying arrays doesn't spuriously re-trigger this either.
const layoutSignature = computed(() =>
  beats.value
    .map(b => `${b.id}:${Math.round(b.x)}:${[...b.characters].sort().join(',')}`)
    .sort()
    .join('|') +
  '::' +
  characters.value.map(c => c.name).sort().join(',')
)

let debounce: ReturnType<typeof setTimeout> | null = null
watch(layoutSignature, (_new, old) => {
  if (debounce) clearTimeout(debounce)
  // Run immediately on first load (old === undefined); debounce afterwards
  // so dragging a node doesn't hammer the worker every frame.
  const delay = old === undefined ? 0 : 300
  debounce = setTimeout(() => {
    requestLayout(boardEl.value?.clientHeight ?? 600)
  }, delay)
}, { immediate: true })

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

// One straight segment per pair of adjacent beats. If more than one
// character makes that same hop, we merge them into a single entry so the
// template can draw one checkered line instead of several stacked ones.
const computedSegments = computed<RenderedSegment[]>(() => {
  const segMap = new Map<string, { from: RenderedNode; to: RenderedNode; colors: string[] }>()

  for (const char of characters.value) {
    const charNodes = renderedNodes.value
      .filter(n => n.characters.includes(char.name))
      .sort((a, b) => a.x - b.x)

    for (let i = 0; i < charNodes.length - 1; i++) {
      const from = charNodes[i]
      const to = charNodes[i + 1]
      const key = `${from.id}->${to.id}`
      if (!segMap.has(key)) segMap.set(key, { from, to, colors: [] })
      segMap.get(key)!.colors.push(char.color)
    }
  }

  return Array.from(segMap.entries()).map(([key, seg]) => ({
    key,
    x1: seg.from.x, y1: seg.from.y,
    x2: seg.to.x,   y2: seg.to.y,
    colors: seg.colors,
  }))
})

// Dash length (px) used for the checkered pattern on multi-character segments.
const DASH = 10

const contentWidth = computed(() => {
  if (!renderedNodes.value.length) return '100%'
  const maxX = Math.max(...renderedNodes.value.map(n => n.x))
  return `max(100%, ${maxX + 600}px)` // Automatically extends 600px past the furthest node
})

const gridLineCount = computed(() => {
  const maxX = renderedNodes.value.length ? Math.max(...renderedNodes.value.map(n => n.x)) : 0
  const pxWidth = Math.max(2000, maxX + 600)
  return Math.ceil(pxWidth / 80)
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

const drag = ref<{ id: string; startX: number; startNodeX: number } | null>(null)

// Helper to pull the X coordinate from either a mouse or a touch event
function getClientX(e: MouseEvent | TouchEvent) {
  return 'touches' in e ? e.touches[0].clientX : e.clientX
}

function startDrag(e: MouseEvent | TouchEvent, id: string) {
  const beat = beats.value.find(b => b.id === id)
  if (beat) drag.value = { id, startX: getClientX(e), startNodeX: beat.x }
}

function onDrag(e: MouseEvent | TouchEvent) {
  if (!drag.value) return
  const beat = beats.value.find(b => b.id === drag.value!.id)
  if (!beat) return

  // Prevent default scroll behavior while actively dragging a node
  if (e.cancelable) e.preventDefault()

  const newX = drag.value.startNodeX + getClientX(e) - drag.value.startX

  // Bound to the left side (30px), but infinite to the right
  beat.x = Math.max(30, newX)
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
    <div
      ref="boardEl"
      class="board"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @mouseleave="endDrag"
      @touchmove="onDrag"
      @touchend="endDrag"
      @touchcancel="endDrag"
    >
      <div class="board-content" :style="{ minWidth: contentWidth }">
        <p v-if="!renderedNodes.length" class="board-empty">
          Canvas is empty — add a node from the panel.
        </p>

        <svg class="board-svg">
          <line
            v-for="i in gridLineCount" :key="i"
            :x1="i * 80" y1="0" :x2="i * 80" y2="100%"
            stroke="#f1f5f9" stroke-width="1"
          />

          <!-- Straight lines only. A hop shared by several characters is
               drawn once, as a single checkered/striped line, rather than as
               several offset, overlapping curves. -->
          <template v-for="seg in computedSegments" :key="seg.key">
            <line
              v-for="(color, idx) in seg.colors" :key="idx"
              :x1="seg.x1" :y1="seg.y1" :x2="seg.x2" :y2="seg.y2"
              :stroke="color"
              stroke-width="2.5"
              stroke-linecap="butt"
              :stroke-dasharray="seg.colors.length > 1 ? `${DASH} ${DASH * (seg.colors.length - 1)}` : undefined"
              :stroke-dashoffset="seg.colors.length > 1 ? -DASH * idx : undefined"
            />
          </template>
        </svg>

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
          @touchstart="startDrag($event, node.id)"
          @click.stop="activeId = node.id"
        >
          <span class="node-label">{{ node.title }}</span>
        </div>
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
