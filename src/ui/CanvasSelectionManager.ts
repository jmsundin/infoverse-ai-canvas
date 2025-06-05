import { Canvas, CanvasNode } from '../obsidian/canvas-internal'
import { CanvasView } from '../obsidian/canvas-patches'
import { CanvasTooltip, TooltipAction } from './CanvasTooltip'

export class CanvasSelectionManager {
    private tooltip: CanvasTooltip | null = null
    private currentCanvas: Canvas | null = null
    private selectionChangeHandler: () => void
    private clickOutsideHandler: (event: MouseEvent) => void
    private isDestroyed = false

    constructor(
        private canvasView: CanvasView,
        private actions: TooltipAction[]
    ) {
        this.selectionChangeHandler = this.handleSelectionChange.bind(this)
        this.clickOutsideHandler = this.handleClickOutside.bind(this)
        this.initialize()
    }

    private initialize() {
        if (this.isDestroyed) return

        this.currentCanvas = this.canvasView.canvas
        if (!this.currentCanvas?.wrapperEl) {
            console.debug('CanvasSelectionManager: Canvas or wrapperEl not available')
            return
        }

        console.debug('CanvasSelectionManager: Initializing with canvas', {
            canvas: !!this.currentCanvas,
            wrapperEl: !!this.currentCanvas.wrapperEl,
            actionsCount: this.actions.length
        })

        // Create tooltip
        this.tooltip = new CanvasTooltip(this.currentCanvas.wrapperEl)
        this.tooltip.setActions(this.actions)

        console.debug('CanvasSelectionManager: Tooltip created and actions set')

        // Start monitoring selection changes
        this.startMonitoring()
    }

    private startMonitoring() {
        if (!this.currentCanvas) return

        // Monitor canvas selection changes using MutationObserver
        // Since we don't have direct access to selection events, we'll poll
        this.monitorSelectionChanges()

        // Add click outside handler
        document.addEventListener('click', this.clickOutsideHandler, true)
    }

    private async monitorSelectionChanges() {
        let lastSelectionSize = 0
        let lastSelectedNodeId: string | null = null

        const checkSelection = () => {
            if (this.isDestroyed || !this.currentCanvas) return

            const selection = this.currentCanvas.selection
            const currentSize = selection.size

            // Debug logging
            if (currentSize > 0) {
                console.debug('CanvasSelectionManager: Selection detected', {
                    size: currentSize,
                    hasActions: this.actions.length > 0,
                    tooltipExists: !!this.tooltip
                })
            }

            // If selection changed
            if (currentSize !== lastSelectionSize) {
                if (currentSize === 1) {
                    // Single node selected
                    const selectedNode = Array.from(selection)[0]
                    if (selectedNode?.id !== lastSelectedNodeId) {
                        console.debug('CanvasSelectionManager: Showing tooltip for node', selectedNode?.id)
                        this.showTooltipForNode(selectedNode)
                        lastSelectedNodeId = selectedNode?.id || null
                    }
                } else {
                    // No selection or multiple selection
                    console.debug('CanvasSelectionManager: Hiding tooltip (selection size:', currentSize, ')')
                    this.hideTooltip()
                    lastSelectedNodeId = null
                }
                lastSelectionSize = currentSize
            }

            // Continue monitoring if not destroyed
            if (!this.isDestroyed) {
                requestAnimationFrame(checkSelection)
            }
        }

        // Start the monitoring loop
        requestAnimationFrame(checkSelection)
    }

    private showTooltipForNode(node: CanvasNode) {
        if (!this.tooltip || this.isDestroyed) return

        // Small delay to ensure the node is properly rendered and positioned
        setTimeout(() => {
            if (!this.isDestroyed && this.tooltip) {
                this.tooltip.show(node)
            }
        }, 50)
    }

    private hideTooltip() {
        if (this.tooltip && !this.isDestroyed) {
            this.tooltip.hide()
        }
    }

    private handleSelectionChange() {
        // This method is kept for potential future use with proper event listeners
        if (this.isDestroyed) return
        // Selection change logic would go here
    }

    private handleClickOutside(event: MouseEvent) {
        if (this.isDestroyed) return

        const target = event.target as HTMLElement

        // Check if click is on a tooltip button
        if (target?.closest('.canvas-node-tooltip')) {
            return // Don't hide tooltip if clicking on it
        }

        // Check if click is on a canvas node
        if (target?.closest('.canvas-node')) {
            return // Let normal selection handling occur
        }

        // Click outside - hide tooltip
        this.hideTooltip()
    }

    updateActions(actions: TooltipAction[]) {
        this.actions = actions
        if (this.tooltip) {
            this.tooltip.setActions(actions)
        }
    }

    destroy() {
        this.isDestroyed = true

        // Remove event listeners
        document.removeEventListener('click', this.clickOutsideHandler, true)

        // Destroy tooltip
        if (this.tooltip) {
            this.tooltip.destroy()
            this.tooltip = null
        }

        this.currentCanvas = null
    }
}
