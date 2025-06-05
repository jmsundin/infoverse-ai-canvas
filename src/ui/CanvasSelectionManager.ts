import { Canvas, CanvasNode } from '../obsidian/canvas-internal'
import { CanvasView } from '../obsidian/canvas-patches'
import { CanvasTooltip, TooltipAction } from './CanvasTooltip'

export class CanvasSelectionManager {
	private tooltip: CanvasTooltip | null = null
	private currentCanvas: Canvas | null = null
	private selectionChangeHandler: () => void
	private clickOutsideHandler: (event: MouseEvent) => void
	private mouseDownHandler: (event: MouseEvent) => void
	private mouseMoveHandler: (event: MouseEvent) => void
	private mouseUpHandler: (event: MouseEvent) => void
	private isDestroyed = false
	private hideTooltipTimeout: NodeJS.Timeout | null = null
	private isDragging = false
	private monitoredNode: CanvasNode | null = null
	private lastNodePosition: { x: number; y: number } | null = null
	private positionCheckInterval: NodeJS.Timeout | null = null
	private stablePositionTimeout: NodeJS.Timeout | null = null

	constructor(
		private canvasView: CanvasView,
		private actions: TooltipAction[]
	) {
		this.selectionChangeHandler = this.handleSelectionChange.bind(this)
		this.clickOutsideHandler = this.handleClickOutside.bind(this)
		this.mouseDownHandler = this.handleMouseDown.bind(this)
		this.mouseMoveHandler = this.handleMouseMove.bind(this)
		this.mouseUpHandler = this.handleMouseUp.bind(this)
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

		// Add event listeners
		document.addEventListener('click', this.clickOutsideHandler, true)
		document.addEventListener('mousedown', this.mouseDownHandler, true)
		document.addEventListener('mousemove', this.mouseMoveHandler, true)
		document.addEventListener('mouseup', this.mouseUpHandler, true)
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
					// Single node selected - start monitoring its position
					console.debug('CanvasSelectionManager: Starting position monitoring for node', selectedNode.id)
					this.startPositionMonitoring(selectedNode)
					lastSelectedNodeId = selectedNode.id
				} else {
					// No selection or multiple selection - stop monitoring and hide tooltip
					console.debug('CanvasSelectionManager: No single selection, stopping position monitoring')
					this.stopPositionMonitoring()
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

	private handleMouseDown(event: MouseEvent) {
		// Mouse events are no longer used for drag detection
		// Position monitoring handles everything automatically
	}

	private handleMouseMove(event: MouseEvent) {
		// Mouse events are no longer used for drag detection
		// Position monitoring handles everything automatically
	}

	private handleMouseUp(event: MouseEvent) {
		// Mouse events are no longer used for drag detection
		// Position monitoring handles everything automatically
	}

	private startPositionMonitoring(node: CanvasNode) {
		// Stop any existing monitoring
		this.stopPositionMonitoring()

		this.monitoredNode = node
		this.lastNodePosition = { x: node.x, y: node.y }
		this.isDragging = false

		console.debug('CanvasSelectionManager: Starting position monitoring for node', node.id)

		// Show tooltip initially if not dragging
		this.showTooltipForNode(node)

		// Check position changes every 16ms (60fps)
		this.positionCheckInterval = setInterval(() => {
			if (!this.monitoredNode || this.isDestroyed) {
				this.stopPositionMonitoring()
				return
			}

			const currentPos = { x: this.monitoredNode.x, y: this.monitoredNode.y }

			if (this.lastNodePosition) {
				const deltaX = Math.abs(currentPos.x - this.lastNodePosition.x)
				const deltaY = Math.abs(currentPos.y - this.lastNodePosition.y)
				const hasPositionChanged = deltaX > 0.1 || deltaY > 0.1

				if (hasPositionChanged) {
					// Position changed - hide tooltip and mark as dragging
					if (!this.isDragging) {
						this.isDragging = true
						console.debug('CanvasSelectionManager: Node position changed, hiding tooltip')
						this.hideTooltip()
					}

					// Clear any existing stable position timeout
					if (this.stablePositionTimeout) {
						clearTimeout(this.stablePositionTimeout)
						this.stablePositionTimeout = null
					}

					// Update last position
					this.lastNodePosition = { ...currentPos }
				} else if (this.isDragging) {
					// Position hasn't changed and we were dragging
					// Set timeout to show tooltip after position stabilizes
					if (!this.stablePositionTimeout) {
						this.stablePositionTimeout = setTimeout(() => {
							if (this.monitoredNode && this.isDragging) {
								console.debug('CanvasSelectionManager: Position stabilized, showing tooltip')
								this.isDragging = false

								// Check if node is still selected before showing tooltip
								if (this.currentCanvas?.selection.size === 1) {
									const selectedNode = Array.from(this.currentCanvas.selection)[0]
									if (selectedNode === this.monitoredNode) {
										this.showTooltipForNode(selectedNode)
									}
								}
							}
							this.stablePositionTimeout = null
						}, 150) // Wait 150ms for position to be stable before showing tooltip
					}
				}
			}
		}, 16)
	}

	private stopPositionMonitoring() {
		if (this.positionCheckInterval) {
			clearInterval(this.positionCheckInterval)
			this.positionCheckInterval = null
		}

		if (this.stablePositionTimeout) {
			clearTimeout(this.stablePositionTimeout)
			this.stablePositionTimeout = null
		}

		this.monitoredNode = null
		this.lastNodePosition = null
		this.isDragging = false

		console.debug('CanvasSelectionManager: Stopped position monitoring')
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
		document.removeEventListener('mousedown', this.mouseDownHandler, true)
		document.removeEventListener('mousemove', this.mouseMoveHandler, true)
		document.removeEventListener('mouseup', this.mouseUpHandler, true)

		// Stop position monitoring and reset state
		this.stopPositionMonitoring()

		// Destroy tooltip
		if (this.tooltip) {
			this.tooltip.destroy()
			this.tooltip = null
		}

		this.currentCanvas = null
	}
}
