import { Canvas, CanvasNode } from '../obsidian/canvas-internal'
import { CanvasView } from '../obsidian/canvas-patches'
import { CanvasTooltip, TooltipAction } from './CanvasTooltip'

export class CanvasSelectionManager {
	private tooltip: CanvasTooltip | null = null
	private currentCanvas: Canvas | null = null
	private selectionChangeHandler: () => void
	private clickOutsideHandler: (event: MouseEvent) => void
	private isDestroyed = false
	private hideTooltipTimeout: NodeJS.Timeout | null = null

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
			const selectedNode = currentSize === 1 ? Array.from(selection)[0] : null

			// Simple debug logging
			if (currentSize > 0 || lastSelectionSize > 0) {
				console.debug('CanvasSelectionManager: Selection state', {
					currentSize,
					lastSelectionSize,
					selectedNodeId: selectedNode?.id,
					lastSelectedNodeId,
					hasTooltip: !!this.tooltip
				})
			}

			// If selection changed
			if (currentSize !== lastSelectionSize || (currentSize === 1 && selectedNode?.id !== lastSelectedNodeId)) {
				console.debug('CanvasSelectionManager: Selection changed', {
					from: { size: lastSelectionSize, nodeId: lastSelectedNodeId },
					to: { size: currentSize, nodeId: selectedNode?.id }
				})

				// Clear any pending hide timeout
				if (this.hideTooltipTimeout) {
					console.debug('CanvasSelectionManager: Clearing pending hide timeout')
					clearTimeout(this.hideTooltipTimeout)
					this.hideTooltipTimeout = null
				}

				if (currentSize === 1 && selectedNode) {
					// Single node selected - show tooltip
					console.debug('CanvasSelectionManager: Showing tooltip for node', selectedNode.id)
					this.showTooltipForNode(selectedNode)
					lastSelectedNodeId = selectedNode.id
				} else {
					// No selection or multiple selection - schedule hide with delay
					console.debug('CanvasSelectionManager: Scheduling tooltip hide', {
						selectionSize: currentSize,
						reason: currentSize === 0 ? 'no selection' : 'multiple selection'
					})

					// Use delay that matches native Obsidian tooltip timing
					const hideDelay = 0 // 200ms (0.2s) - matches native Obsidian tooltips

					this.hideTooltipTimeout = setTimeout(() => {
						console.debug('CanvasSelectionManager: Executing scheduled hide')

						// Final check before hiding
						const finalSelection = this.currentCanvas?.selection
						const finalSize = finalSelection?.size || 0

						if (finalSize !== 1) {
							console.debug('CanvasSelectionManager: Hiding tooltip')
							this.hideTooltip()
							lastSelectedNodeId = null
						} else {
							console.debug('CanvasSelectionManager: Cancelled hide - selection is active')
						}
						this.hideTooltipTimeout = null
					}, hideDelay)
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

		console.debug('CanvasSelectionManager: Click outside handler triggered', {
			targetTagName: target?.tagName,
			targetClassName: target?.className,
			targetClosest: {
				tooltip: !!target?.closest('.canvas-node-tooltip'),
				canvasNode: !!target?.closest('.canvas-node'),
				nodeContent: !!target?.closest('.canvas-node-content'),
				markdown: !!target?.closest('.cm-editor')
			}
		})

		// Check if click is on a tooltip button
		if (target?.closest('.canvas-node-tooltip')) {
			console.debug('CanvasSelectionManager: Click on tooltip, not hiding')
			return // Don't hide tooltip if clicking on it
		}

		// Check if click is on a canvas node or its content
		if (target?.closest('.canvas-node') || target?.closest('.canvas-node-content') || target?.closest('.cm-editor')) {
			console.debug('CanvasSelectionManager: Click on canvas node or content, not hiding')
			return // Let normal selection handling occur
		}

		// Check if any node is currently being edited
		if (this.currentCanvas) {
			const hasEditingNode = this.currentCanvas.nodes.some(node => node.isEditing)
			if (hasEditingNode) {
				console.debug('CanvasSelectionManager: Node is being edited, not hiding tooltip')
				return
			}
		}

		// Click outside - hide tooltip
		console.debug('CanvasSelectionManager: Click outside detected, hiding tooltip')
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

		// Clear any pending timeout
		if (this.hideTooltipTimeout) {
			clearTimeout(this.hideTooltipTimeout)
			this.hideTooltipTimeout = null
		}

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
