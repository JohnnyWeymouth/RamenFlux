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

// Recency tracking for character additions (charName -> timestamp)
const charLastAdded = ref<Record<string, number>>({})

// Multi-selection State
const selectedIds = ref<Set<string>>(new Set())
const activeId    = ref<string | null>(null) // Primary beat focused in modal

const newCharName = ref('')
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
// Recency Helpers & Computed Characters
// ---------------------------------------------------------------------------

function markCharAsRecentlyAdded(name: string) {
  charLastAdded.value = {
    ...charLastAdded.value,
    [name]: Date.now()
  }
}

const sortedCharactersForModal = computed(() => {
  return [...characters.value].sort((a, b) => {
    // 1. Prioritize characters selected in the currently active beat
    const aSelected = activeBeat.value?.characters.includes(a.name) ?? false
    const bSelected = activeBeat.value?.characters.includes(b.name) ?? false

    if (aSelected !== bSelected) {
      return aSelected ? -1 : 1
    }

    // 2. Fall back to priority queue (most recently added first)
    const timeA = charLastAdded.value[a.name] ?? 0
    const timeB = charLastAdded.value[b.name] ?? 0
    if (timeA !== timeB) {
      return timeB - timeA
    }

    // 3. Fall back to alphabetical tie-breaking
    return a.name.localeCompare(b.name)
  })
})

function toggleCharInActiveBeat(charName: string) {
  if (!activeBeat.value) return
  const idx = activeBeat.value.characters.indexOf(charName)
  if (idx > -1) {
    activeBeat.value.characters.splice(idx, 1)
  } else {
    activeBeat.value.characters.push(charName)
    markCharAsRecentlyAdded(charName)
  }
}

// ---------------------------------------------------------------------------
// Selection Box State & Helpers
// ---------------------------------------------------------------------------

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const selectionBox = ref<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)

const selectionBoxStyle = computed(() => {
  if (!selectionBox.value) return {}
  const x = Math.min(selectionBox.value.startX, selectionBox.value.currentX)
  const y = Math.min(selectionBox.value.startY, selectionBox.value.currentY)
  const w = Math.abs(selectionBox.value.currentX - selectionBox.value.startX)
  const h = Math.abs(selectionBox.value.currentY - selectionBox.value.startY)
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`
  }
})

function clearSelection() {
  selectedIds.value.clear()
}

function selectNode(id: string, multi = false) {
  if (multi) {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }
  } else {
    selectedIds.value = new Set([id])
  }
}

// ---------------------------------------------------------------------------
// Command Pattern / Undo & Redo History
// ---------------------------------------------------------------------------

interface Command {
  execute: () => void
  undo: () => void
}

const historyStack = ref<Command[]>([])
const redoStack = ref<Command[]>([])

const canUndo = computed(() => historyStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

function executeCommand(cmd: Command) {
  cmd.execute()
  historyStack.value.push(cmd)
  redoStack.value = []
}

function undo() {
  const cmd = historyStack.value.pop()
  if (cmd) {
    cmd.undo()
    redoStack.value.push(cmd)
  }
}

function redo() {
  const cmd = redoStack.value.pop()
  if (cmd) {
    cmd.execute()
    historyStack.value.push(cmd)
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'z') {
      if (e.shiftKey) redo()
      else undo()
    } else if (e.key.toLowerCase() === 'y') {
      redo()
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-Node Drag & Selection Engine
// ---------------------------------------------------------------------------

const drag = ref<{
  startX: number
  startPositions: Map<string, number>
} | null>(null)

let dragDistance = 0 

function getClientX(e: MouseEvent | TouchEvent) {
  return 'touches' in e ? e.touches[0].clientX : e.clientX
}

function getClientY(e: MouseEvent | TouchEvent) {
  return 'touches' in e ? e.touches[0].clientY : e.clientY
}

function startDrag(e: MouseEvent | TouchEvent, id: string) {
  const isMultiKey = 'shiftKey' in e && (e.shiftKey || e.ctrlKey || e.metaKey)

  if (!selectedIds.value.has(id)) {
    if (isMultiKey) {
      selectedIds.value.add(id)
    } else {
      selectedIds.value = new Set([id])
    }
  }

  const startPositions = new Map<string, number>()
  for (const selectedId of selectedIds.value) {
    const b = beats.value.find(beat => beat.id === selectedId)
    if (b) startPositions.set(selectedId, b.x)
  }

  drag.value = {
    startX: getClientX(e),
    startPositions
  }
  dragDistance = 0
}

function startBoardSelection(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.node')) return

  const boardRect = boardEl.value?.getBoundingClientRect()
  if (!boardRect) return

  const x = e.clientX - boardRect.left
  const y = e.clientY - boardRect.top

  selectionBox.value = { startX: x, startY: y, currentX: x, currentY: y }

  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
    clearSelection()
  }
}

function onDrag(e: MouseEvent | TouchEvent) {
  const currentX = getClientX(e)

  if (selectionBox.value && 'clientX' in e && boardEl.value) {
    const boardRect = boardEl.value.getBoundingClientRect()
    selectionBox.value.currentX = e.clientX - boardRect.left
    selectionBox.value.currentY = e.clientY - boardRect.top

    const boxX1 = Math.min(selectionBox.value.startX, selectionBox.value.currentX)
    const boxX2 = Math.max(selectionBox.value.startX, selectionBox.value.currentX)
    const boxY1 = Math.min(selectionBox.value.startY, selectionBox.value.currentY)
    const boxY2 = Math.max(selectionBox.value.startY, selectionBox.value.currentY)

    renderedNodes.value.forEach(node => {
      const inBox = node.x >= boxX1 && node.x <= boxX2 && node.y >= boxY1 && node.y <= boxY2
      if (inBox) {
        selectedIds.value.add(node.id)
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        selectedIds.value.delete(node.id)
      }
    })
    return
  }

  if (!drag.value) return
  if (e.cancelable) e.preventDefault()

  const deltaX = currentX - drag.value.startX
  dragDistance = Math.abs(deltaX)

  drag.value.startPositions.forEach((initialX, id) => {
    const beat = beats.value.find(b => b.id === id)
    if (beat) {
      beat.x = Math.max(30, initialX + deltaX)
    }
  })
}

function endDrag() { 
  if (selectionBox.value) {
    selectionBox.value = null
  }

  if (drag.value) {
    const startPositions = drag.value.startPositions
    const finalPositions = new Map<string, number>()
    
    let hasMoved = false
    startPositions.forEach((initialX, id) => {
      const beat = beats.value.find(b => b.id === id)
      if (beat) {
        finalPositions.set(id, beat.x)
        if (beat.x !== initialX) hasMoved = true
      }
    })

    if (hasMoved) {
      executeCommand({
        execute: () => {
          finalPositions.forEach((x, id) => {
            const b = beats.value.find(beat => beat.id === id)
            if (b) b.x = x
          })
        },
        undo: () => {
          startPositions.forEach((x, id) => {
            const b = beats.value.find(beat => beat.id === id)
            if (b) b.x = x
          })
        }
      })
      triggerLayoutRecalc(0)
    }
  }
  drag.value = null 
}

function handleNodeClick(e: MouseEvent, id: string) {
  if (dragDistance > 5) return

  const isMultiKey = e.shiftKey || e.ctrlKey || e.metaKey
  selectNode(id, isMultiKey)

  if (!isMultiKey) {
    openModal(id)
  }
}

// ---------------------------------------------------------------------------
// Layout Worker & Derived State
// ---------------------------------------------------------------------------

const { request: requestLayout, dispose } = useLayoutWorker(beats, characters)

const layoutSignature = computed(() =>
  beats.value
    .map(b => `${b.id}:${Math.round(b.x)}:${[...b.characters].sort().join(',')}`)
    .sort()
    .join('|') +
  '::' +
  characters.value.map(c => c.name).sort().join(',')
)

let debounce: ReturnType<typeof setTimeout> | null = null

const triggerLayoutRecalc = (delay = 300) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    requestLayout(boardEl.value?.clientHeight ?? 600)
  }, delay)
}

watch(layoutSignature, (_new, old) => {
  if (drag.value) return
  const delay = old === undefined ? 0 : 300
  triggerLayoutRecalc(delay)
}, { immediate: true })

const handleResize = () => triggerLayoutRecalc(150)

onMounted(() => {
  window.addEventListener('resize', handleResize)
  window.addEventListener('orientationchange', handleResize)
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  dispose()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('orientationchange', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
})

const activeBeat = computed(() => beats.value.find(b => b.id === activeId.value))
const charNames = computed(() => characters.value.map(c => c.name))

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

let activeBeatSnapshot: string | null = null

function addBeat(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const startX = Math.max(30, event.clientX - rect.left + target.scrollLeft)

  const newBeat: Beat = {
    id: crypto.randomUUID(),
    x: startX,
    title: 'New Plot Beat',
    characters: [],
    importance: 3,
    details: ''
  }

  executeCommand({
    execute: () => beats.value.push(newBeat),
    undo: () => {
      beats.value = beats.value.filter(b => b.id !== newBeat.id)
    }
  })

  openModal(newBeat.id)
}

function openModal(id: string) {
  activeId.value = id
  const b = beats.value.find(beat => beat.id === id)
  if (b) {
    activeBeatSnapshot = JSON.stringify(b)
  }
  isModalOpen.value = true
}

function closeModal() {
  if (activeBeatSnapshot && activeId.value) {
    const currentBeat = beats.value.find(b => b.id === activeId.value)
    if (currentBeat) {
      const beforeData = JSON.parse(activeBeatSnapshot)
      const afterData = JSON.parse(JSON.stringify(currentBeat))

      if (activeBeatSnapshot !== JSON.stringify(afterData)) {
        const targetId = activeId.value
        historyStack.value.push({
          execute: () => {
            const b = beats.value.find(beat => beat.id === targetId)
            if (b) Object.assign(b, afterData)
          },
          undo: () => {
            const b = beats.value.find(beat => beat.id === targetId)
            if (b) Object.assign(b, beforeData)
          }
        })
        redoStack.value = []
      }
    }
  }
  isModalOpen.value = false
  activeBeatSnapshot = null
}

function deleteActiveBeat() {
  if (!activeBeat.value) return
  const beatToDelete = activeBeat.value
  const idx = beats.value.findIndex(b => b.id === beatToDelete.id)
  if (idx === -1) return

  executeCommand({
    execute: () => {
      const currentIdx = beats.value.findIndex(b => b.id === beatToDelete.id)
      if (currentIdx !== -1) beats.value.splice(currentIdx, 1)
      trashed.value.push(beatToDelete)
    },
    undo: () => {
      trashed.value = trashed.value.filter(b => b.id !== beatToDelete.id)
      beats.value.splice(idx, 0, beatToDelete)
    }
  })

  closeModal()
}

function restoreBeat(id: string) {
  const idx = trashed.value.findIndex(b => b.id === id)
  if (idx === -1) return
  const beatToRestore = trashed.value[idx]

  executeCommand({
    execute: () => {
      const currentIdx = trashed.value.findIndex(b => b.id === id)
      if (currentIdx !== -1) trashed.value.splice(currentIdx, 1)
      beats.value.push(beatToRestore)
    },
    undo: () => {
      beats.value = beats.value.filter(b => b.id !== id)
      trashed.value.splice(idx, 0, beatToRestore)
    }
  })
}

// ---------------------------------------------------------------------------
// Character actions & Edits
// ---------------------------------------------------------------------------

function addGlobalChar() {
  const name = newCharName.value.trim()
  if (!name || charNames.value.includes(name)) return
  const color = COLOR_PALETTE[characters.value.length % COLOR_PALETTE.length]
  const newChar = { name, color }

  executeCommand({
    execute: () => {
      characters.value.push(newChar)
      markCharAsRecentlyAdded(name)
    },
    undo: () => {
      characters.value = characters.value.filter(c => c.name !== name)
    }
  })
  newCharName.value = ''
}

function createAndAddCharInModal() {
  const name = modalNewCharName.value.trim()
  if (!name || !activeBeat.value) return

  const targetBeat = activeBeat.value
  const isGlobalNew = !charNames.value.includes(name)
  const color = COLOR_PALETTE[characters.value.length % COLOR_PALETTE.length]

  executeCommand({
    execute: () => {
      if (isGlobalNew) characters.value.push({ name, color })
      if (!targetBeat.characters.includes(name)) targetBeat.characters.push(name)
      markCharAsRecentlyAdded(name)
    },
    undo: () => {
      targetBeat.characters = targetBeat.characters.filter(c => c !== name)
      if (isGlobalNew) characters.value = characters.value.filter(c => c.name !== name)
    }
  })
  modalNewCharName.value = ''
}

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

  const oldName = activeCharName.value
  if (newName !== oldName && charNames.value.includes(newName)) {
    alert('Character name must be unique.')
    return
  }

  const beforeChars = JSON.parse(JSON.stringify(characters.value))
  const beforeBeats = JSON.parse(JSON.stringify(beats.value))
  const newColor = editCharColor.value

  executeCommand({
    execute: () => {
      const charIndex = characters.value.findIndex(c => c.name === oldName)
      if (charIndex !== -1) {
        characters.value[charIndex].name = newName
        characters.value[charIndex].color = newColor

        if (newName !== oldName) {
          const cascadeRename = (beatList: Beat[]) => {
            beatList.forEach(beat => {
              const idx = beat.characters.indexOf(oldName)
              if (idx !== -1) beat.characters.splice(idx, 1, newName)
            })
          }
          cascadeRename(beats.value)
          cascadeRename(trashed.value)
          if (charLastAdded.value[oldName]) {
            charLastAdded.value[newName] = charLastAdded.value[oldName]
            delete charLastAdded.value[oldName]
          }
        }
      }
    },
    undo: () => {
      characters.value = beforeChars
      beats.value = beforeBeats
    }
  })
  closeCharModal()
}

function deleteCharacter() {
  if (!activeCharName.value) return
  if (!confirm(`Are you sure you want to delete ${activeCharName.value}? This will remove them from all beats.`)) return
  
  const nameToDelete = activeCharName.value
  const beforeChars = JSON.parse(JSON.stringify(characters.value))
  const beforeBeats = JSON.parse(JSON.stringify(beats.value))
  const beforeTrashed = JSON.parse(JSON.stringify(trashed.value))

  executeCommand({
    execute: () => {
      characters.value = characters.value.filter(c => c.name !== nameToDelete)
      const cascadeDelete = (beatList: Beat[]) => {
        beatList.forEach(beat => {
          beat.characters = beat.characters.filter(n => n !== nameToDelete)
        })
      }
      cascadeDelete(beats.value)
      cascadeDelete(trashed.value)
    },
    undo: () => {
      characters.value = beforeChars
      beats.value = beforeBeats
      trashed.value = beforeTrashed
    }
  })
  
  closeCharModal()
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
        const oldChars = JSON.parse(JSON.stringify(characters.value))
        const oldBeats = JSON.parse(JSON.stringify(beats.value))
        const oldTrashed = JSON.parse(JSON.stringify(trashed.value))

        executeCommand({
          execute: () => {
            characters.value = parsed.characters
            beats.value = parsed.beats
            trashed.value = []
            selectedIds.value.clear()
            activeId.value = beats.value[0]?.id ?? null
          },
          undo: () => {
            characters.value = oldChars
            beats.value = oldBeats
            trashed.value = oldTrashed
          }
        })
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

      <div style="display: flex; gap: 8px; margin-bottom: 8px;">
        <button class="btn-io" :disabled="!canUndo" @click="undo" style="flex: 1">↩️ Undo</button>
        <button class="btn-io" :disabled="!canRedo" @click="redo" style="flex: 1">↪️ Redo</button>
      </div>

      <div>➕ Double-click canvas to add a Plot Beat</div>

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
      @mousedown="startBoardSelection"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @mouseleave="endDrag"
      @touchmove="onDrag"
      @touchend="endDrag"
      @touchcancel="endDrag"
      @dblclick="addBeat"
    >
      <div class="board-content" :style="{ minWidth: contentWidth }">
        <p v-if="!renderedNodes.length" class="board-empty">
          Canvas is empty — double-click anywhere to add a node.
        </p>

        <!-- Selection Box Element -->
        <div 
          v-if="selectionBox" 
          class="selection-box"
          :style="selectionBoxStyle"
        ></div>

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
          :class="{ active: selectedIds.has(node.id) }"
          :style="{
            left: node.x + 'px',
            top: node.y + 'px',
            width: node.radius * 2 + 'px',
            height: node.radius * 2 + 'px',
            background: nodeGradient(node),
          }"
          @mousedown="startDrag($event, node.id)"
          @touchstart="startDrag($event, node.id)"
          @click.stop="handleNodeClick($event, node.id)"
        >
          <span class="node-label">{{ node.title }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal for Beat Editing -->
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
        
        <h5 style="margin-bottom: 8px;">Characters Present</h5>
        
        <!-- Checkbox Selection List sorted by recency -->
        <div class="char-checkbox-list">
          <p v-if="!characters.length" class="muted" style="margin: 4px 0;">No characters registered yet.</p>
          <label
            v-for="c in sortedCharactersForModal"
            :key="c.name"
            class="char-checkbox-item"
          >
            <input
              type="checkbox"
              :checked="activeBeat.characters.includes(c.name)"
              @change="toggleCharInActiveBeat(c.name)"
            />
            <span class="char-color-preview" :style="{ backgroundColor: c.color }"></span>
            <span class="char-name">{{ c.name }}</span>
          </label>
        </div>

        <div class="new-char-inline" style="margin-top: 12px;">
          <input 
            type="text" 
            v-model="modalNewCharName" 
            placeholder="Create & attach new character..." 
            @keyup.enter="createAndAddCharInModal" 
          />
          <button class="btn-io" @click="createAndAddCharInModal">Add</button>
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