<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { useLayoutWorker } from './useLayoutWorker'
import type { Beat, Character, RenderedNode, RenderedSegment } from './types'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const characters  = ref<Character[]>([])
const beats       = ref<Beat[]>([])
const trashed     = ref<Beat[]>([])
const activeId    = ref<string | null>(null)
const newCharName = ref('')
const charToAdd   = ref('')
const modalNewCharName = ref('')
const isSidebarOpen = ref(true)

// Modal states
const isModalOpen = ref(false)
const isTrashModalOpen = ref(false)
const isCharModalOpen = ref(false)

// Character Edit State
const activeCharName = ref<string | null>(null)
const editCharName = ref('')
const editCharColor = ref('')

const boardEl   = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const COLOR_PALETTE = ['#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#ef4444', '#10b981']

// ---------------------------------------------------------------------------
// Layout worker
// ---------------------------------------------------------------------------

const { request: requestLayout, dispose } = useLayoutWorker(beats, characters)

// 1. Define the reactive signature first so it is available to the watcher
const layoutSignature = computed(() =>
  beats.value
    .map(b => `${b.id}:${Math.round(b.x)}:${[...b.characters].sort().join(',')}`)
    .sort()
    .join('|') +
  '::' +
  characters.value.map(c => c.name).sort().join(',')
)

// 2. Declare a single block-scoped debounce token variable
let debounce: ReturnType<typeof setTimeout> | null = null

const triggerLayoutRecalc = (delay = 300) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    requestLayout(boardEl.value?.clientHeight ?? 600)
  }, delay)
}

// 3. Watch the computed layout signature for state changes
watch(layoutSignature, (_new, old) => {
  const delay = old === undefined ? 0 : 300
  triggerLayoutRecalc(delay)
}, { immediate: true })

// 4. Handle resize & orientation events cleanly
const handleResize = () => triggerLayoutRecalc(150)

onMounted(() => {
  window.addEventListener('resize', handleResize)
  window.addEventListener('orientationchange', handleResize)
})

onUnmounted(() => {
  dispose()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('orientationchange', handleResize)
})

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

const DASH = 10

const contentWidth = computed(() => {
  if (!renderedNodes.value.length) return '100%'
  const maxX = Math.max(...renderedNodes.value.map(n => n.x))
  return `max(100%, ${maxX + 600}px)`
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
// Actions & Modals
// ---------------------------------------------------------------------------

function addBeat() {
  const id = crypto.randomUUID()
  const canvasCenter = (boardEl.value?.clientWidth ?? 800) / 2
  const startX = renderedNodes.value.length ? Math.max(...renderedNodes.value.map(n => n.x)) + 120 : canvasCenter

  beats.value.push({ id, x: startX, title: 'New Plot Beat', characters: [], importance: 3, details: '' })
  activeId.value = id
  isModalOpen.value = true
}

function openModal(id: string) {
  activeId.value = id
  isModalOpen.value = true
}

function closeModal() {
  isModalOpen.value = false
}

function deleteActiveBeat() {
  if (!activeBeat.value) return
  const idx = beats.value.findIndex(b => b.id === activeBeat.value!.id)
  if (idx !== -1) {
    trashed.value.push(beats.value[idx])
    beats.value.splice(idx, 1)
  }
  closeModal()
}

function restoreBeat(id: string) {
  const idx = trashed.value.findIndex(b => b.id === id)
  if (idx === -1) return
  const [beat] = trashed.value.splice(idx, 1)
  beats.value.push(beat)
}

// ---------------------------------------------------------------------------
// Character actions
// ---------------------------------------------------------------------------

function addGlobalChar() {
  const name = newCharName.value.trim()
  if (!name || charNames.value.includes(name)) return
  const color = COLOR_PALETTE[characters.value.length % COLOR_PALETTE.length]
  characters.value.push({ name, color })
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

function createAndAddCharInModal() {
  const name = modalNewCharName.value.trim()
  if (!name || !activeBeat.value) return

  if (!charNames.value.includes(name)) {
    const color = COLOR_PALETTE[characters.value.length % COLOR_PALETTE.length]
    characters.value.push({ name, color })
  }
  
  if (!activeBeat.value.characters.includes(name)) {
    activeBeat.value.characters.push(name)
  }
  modalNewCharName.value = ''
}

// ---------------------------------------------------------------------------
// Character Editing & Deletion
// ---------------------------------------------------------------------------

function openCharModal(char: Character) {
  activeCharName.value = char.name
  editCharName.value = char.name
  editCharColor.value = char.color
  isCharModalOpen.value = true
}

function closeCharModal() {
  isCharModalOpen.value = false
  activeCharName.value = null
}

function saveCharacter() {
  if (!activeCharName.value) return
  
  const newName = editCharName.value.trim()
  if (!newName) return

  if (newName !== activeCharName.value && charNames.value.includes(newName)) {
    alert('Character name must be unique.')
    return
  }

  const oldName = activeCharName.value
  const charIndex = characters.value.findIndex(c => c.name === oldName)
  
  if (charIndex !== -1) {
    characters.value[charIndex].name = newName
    characters.value[charIndex].color = editCharColor.value

    if (newName !== oldName) {
      const cascadeRename = (beatList: Beat[]) => {
        beatList.forEach(beat => {
          const idx = beat.characters.indexOf(oldName)
          if (idx !== -1) beat.characters.splice(idx, 1, newName)
        })
      }
      cascadeRename(beats.value)
      cascadeRename(trashed.value)
    }
  }
  closeCharModal()
}

function deleteCharacter() {
  if (!activeCharName.value) return
  if (!confirm(`Are you sure you want to delete ${activeCharName.value}? This will remove them from all beats.`)) return
  
  const nameToDelete = activeCharName.value

  characters.value = characters.value.filter(c => c.name !== nameToDelete)
  
  const cascadeDelete = (beatList: Beat[]) => {
    beatList.forEach(beat => {
      beat.characters = beat.characters.filter(n => n !== nameToDelete)
    })
  }
  
  cascadeDelete(beats.value)
  cascadeDelete(trashed.value)
  
  closeCharModal()
}

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

const drag = ref<{ id: string; startX: number; startNodeX: number } | null>(null)
let dragDistance = 0 

function getClientX(e: MouseEvent | TouchEvent) {
  return 'touches' in e ? e.touches[0].clientX : e.clientX
}

function startDrag(e: MouseEvent | TouchEvent, id: string) {
  const beat = beats.value.find(b => b.id === id)
  if (beat) {
    drag.value = { id, startX: getClientX(e), startNodeX: beat.x }
    dragDistance = 0
  }
}

function onDrag(e: MouseEvent | TouchEvent) {
  if (!drag.value) return
  const beat = beats.value.find(b => b.id === drag.value!.id)
  if (!beat) return

  if (e.cancelable) e.preventDefault()

  const currentX = getClientX(e)
  dragDistance = Math.abs(currentX - drag.value.startX)
  
  const newX = drag.value.startNodeX + currentX - drag.value.startX
  beat.x = Math.max(30, newX)
}

function endDrag() { drag.value = null }

function handleNodeClick(id: string) {
  if (dragDistance > 5) return
  openModal(id)
}

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
        trashed.value = []
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
  <div class="layout">
    
    <button 
      class="sidebar-toggle" 
      :class="{ 'is-collapsed': !isSidebarOpen }"
      @click="isSidebarOpen = !isSidebarOpen"
      title="Toggle sidebar"
    >
      {{ isSidebarOpen ? '◀' : '▶' }}
    </button>

    <aside class="panel" :class="{ 'is-collapsed': !isSidebarOpen }">
      <div class="brand-header">
        <h1>RamenFlux</h1>
        <img src="https://placehold.co/100x100/1e293b/ffffff?text=RF" alt="Logo" class="brand-logo" />
      </div>

      <p class="brand-subtitle">Drag plot-beats side to side. Track characters across beats.</p>

      <button class="btn-action btn-green" @click="addBeat">➕ Add plot beat</button>

      <button class="btn-io" @click="isTrashModalOpen = true">🗑️ View Trash</button>

      <button class="btn-io" @click="exportData">📤 Download JSON</button>

      <button class="btn-io" @click="importClick">📥 Import saved JSON</button>
      <input ref="fileInput" type="file" style="display:none" @change="onImport" />

      <section class="card char-section">
        <h4>👥 Characters</h4>

        <div class="divider" />

        <input type="text" v-model="newCharName" placeholder="New character name" @keyup.enter="addGlobalChar" />
        <button class="btn-action btn-slate" @click="addGlobalChar">Register</button>

        <div class="divider" />

        <div class="char-list">
          <div v-for="c in characters" :key="c.name" class="char-entry" @click="openCharModal(c)">
            <div class="char-color-preview" :style="{ backgroundColor: c.color }"></div>
            <span>{{ c.name }}</span>
          </div>
          <p v-if="!characters.length" class="muted" style="margin-bottom:8px">No characters yet.</p>
        </div>
      </section>

    </aside>

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
          @click.stop="handleNodeClick(node.id)"
        >
          <span class="node-label">{{ node.title }}</span>
        </div>
      </div>
    </div>
  </div>

  <div v-if="isModalOpen" class="modal-overlay" @mousedown.self="closeModal">
    <div class="modal-content" v-if="activeBeat">
      <div class="modal-header">
        <h3>Edit Plot Beat</h3>
        <button class="btn-icon" @click="closeModal">✖</button>
      </div>

      <div class="modal-body">
        <h5 style="margin-bottom: 8px;">General</h5>
        <label class="field-label">Beat Name</label>
        <input type="text" v-model="activeBeat.title" placeholder="e.g. The Bank Heist" />

        <label class="field-label" style="margin-top:12px">Details</label>
        <textarea v-model="activeBeat.details" placeholder="Scene details, location, context, etc…" />

        <div class="divider" />
        
        <h5 style="margin-bottom: 8px;">Characters present</h5>
        <div class="active-chars">
          <p v-if="!activeBeat.characters.length" class="muted">None yet.</p>
          <div v-for="name in activeBeat.characters" :key="name" class="char-row">
            <span>{{ name }}</span>
            <button class="btn-icon" @click="removeCharFromBeat(name)">❌</button>
          </div>
        </div>

        <div class="add-char-tools">
          <select v-if="availableChars.length" v-model="charToAdd" @change="addCharToBeat">
            <option value="" disabled selected>➕ Add existing character…</option>
            <option v-for="c in availableChars" :key="c" :value="c">{{ c }}</option>
          </select>
          
          <div class="new-char-inline">
            <input type="text" v-model="modalNewCharName" placeholder="Or create a brand new character..." @keyup.enter="createAndAddCharInModal" />
            <button class="btn-io" @click="createAndAddCharInModal">Add</button>
          </div>
        </div>

        <div class="divider" />

        <div style="display:flex; gap: 16px;">
          <div style="flex: 2;">
            <h5 style="margin-bottom: 8px;">Importance</h5>
            <input type="range" min="1" max="5" step="1" v-model.number="activeBeat.importance" />
            <div class="range-labels">
              <span>Less</span><span>More</span>
            </div>
          </div>
        </div>

        <div class="divider" />

        <div style="display:flex; gap: 16px;">
          <div style="flex: 1;">
            <label class="field-label">X-Coordinate</label>
            <input type="number" v-model.number="activeBeat.x" class="num-input" />
          </div>
        </div>

      </div>

      <div class="modal-footer">
        <button class="btn-io text-danger" @click="deleteActiveBeat">🗑️ Delete Beat</button>
        <button class="btn-action" style="width: auto; padding: 8px 24px;" @click="closeModal">Done</button>
      </div>
    </div>
  </div>

  <div v-if="isTrashModalOpen" class="modal-overlay" @mousedown.self="isTrashModalOpen = false">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Trash Bin</h3>
        <button class="btn-icon" @click="isTrashModalOpen = false">✖</button>
      </div>
      
      <div class="modal-body">
        <p v-if="!trashed.length" class="muted" style="text-align: center; padding: 20px 0;">
          Trash is empty.
        </p>
        <div v-for="b in trashed" :key="b.id" class="trash-row">
          <span class="trash-title">{{ b.title }}</span>
          <button class="btn-restore" @click="restoreBeat(b.id)">↩️ Restore</button>
        </div>
      </div>

      <div class="modal-footer" style="justify-content: flex-end;">
        <button class="btn-action" style="width: auto; padding: 8px 24px;" @click="isTrashModalOpen = false">Close</button>
      </div>
    </div>
  </div>

  <div v-if="isCharModalOpen" class="modal-overlay" @mousedown.self="closeCharModal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Edit Character</h3>
        <button class="btn-icon" @click="closeCharModal">✖</button>
      </div>

      <div class="modal-body">
        <label class="field-label">Character Name</label>
        <input type="text" v-model="editCharName" placeholder="e.g. John Doe" @keyup.enter="saveCharacter" />

        <label class="field-label" style="margin-top:12px">Character Color</label>
        <input 
          type="color" 
          v-model="editCharColor" 
          style="width: 100%; height: 40px; padding: 2px; cursor: pointer; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff;" 
        />
      </div>

      <div class="modal-footer">
        <button class="btn-io text-danger" @click="deleteCharacter">🗑️ Delete Character</button>
        <button class="btn-action" style="width: auto; padding: 8px 24px;" @click="saveCharacter">Save Changes</button>
      </div>
    </div>
  </div>
</template>