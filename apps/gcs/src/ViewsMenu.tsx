/**
 * Multi-select for which panels are on screen.
 *
 * A native <select multiple> can't be styled to match and is awkward with a
 * pointer, so this is a button plus a checkbox popover — the shape operators
 * expect from a "Views" control.
 */

import { useEffect, useRef, useState } from 'react'

export type ViewId = 'instruments' | 'map' | 'video' | 'mission'

export interface ViewOption {
  id: ViewId
  label: string
}

/**
 * Left-to-right column order when visible. This list is the single source of
 * order — App renders panels by mapping it, so the DOM order and the column
 * weights cannot drift apart.
 */
export const VIEW_OPTIONS: ViewOption[] = [
  { id: 'instruments', label: 'Instruments' },
  { id: 'map', label: 'Map' },
  { id: 'video', label: 'Video' },
  { id: 'mission', label: 'Mission' },
]

interface ViewsMenuProps {
  visible: Record<ViewId, boolean>
  onToggle: (id: ViewId) => void
}

export function ViewsMenu({ visible, onToggle }: ViewsMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Dismiss on outside click or Escape, the two ways anyone closes a popover.
  useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const activeCount = VIEW_OPTIONS.filter((option) => visible[option.id]).length

  return (
    <div className="views-menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'segment active' : 'segment'}
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        Views ({activeCount})
      </button>

      {open ? (
        <div className="views-popover" role="group" aria-label="Visible panels">
          {VIEW_OPTIONS.map((option) => (
            <label key={option.id} className="views-option">
              <input
                type="checkbox"
                checked={visible[option.id]}
                onChange={() => onToggle(option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}
