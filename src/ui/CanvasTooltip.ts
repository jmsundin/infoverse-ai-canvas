import { setIcon } from 'obsidian'
import { CanvasNode } from '../obsidian/canvas-internal'

export interface TooltipAction {
	id: string
	icon: string
	tooltip: string
	action: (node: CanvasNode) => void
}

export class CanvasTooltip {
	private tooltipEl: HTMLElement | null = null
	private selectedNode: CanvasNode | null = null
	private actions: TooltipAction[] = []

	constructor(private containerEl: HTMLElement) {
		this.createTooltipElement()
	}

	private createTooltipElement() {
		this.tooltipEl = document.createElement('div')
		this.tooltipEl.className = 'canvas-node-tooltip'
		this.tooltipEl.style.cssText = `
			position: absolute;
			display: none;
			background: var(--background-primary);
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			padding: 4px;
			z-index: 1000;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
			backdrop-filter: blur(8px);
			opacity: 0;
			transform: translateY(10px);
			transition: opacity 0.2s ease, transform 0.2s ease;
			gap: 4px;
			align-items: center;
		`
		this.containerEl.appendChild(this.tooltipEl)
	}

	setActions(actions: TooltipAction[]) {
		console.debug('CanvasTooltip: Setting actions', {
			count: actions.length,
			actions: actions.map(a => ({ id: a.id, icon: a.icon, tooltip: a.tooltip }))
		})
		this.actions = actions
		this.updateTooltipContent()
	}

	private updateTooltipContent() {
		if (!this.tooltipEl) return

		this.tooltipEl.innerHTML = ''

		this.actions.forEach(action => {
			const buttonEl = document.createElement('button')
			buttonEl.className = 'canvas-tooltip-button'
			buttonEl.setAttribute('aria-label', action.tooltip)
			buttonEl.setAttribute('data-tooltip', action.tooltip)
			buttonEl.style.cssText = `
				background: transparent;
				border: none;
				padding: 8px;
				border-radius: 6px;
				cursor: pointer;
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--text-muted);
				transition: all 0.15s ease;
				width: 32px;
				height: 32px;
			`

			// Add hover styles
			buttonEl.addEventListener('mouseenter', () => {
				buttonEl.style.background = 'var(--background-modifier-hover)'
				buttonEl.style.color = 'var(--text-normal)'
				buttonEl.style.transform = 'scale(1.05)'
			})

			buttonEl.addEventListener('mouseleave', () => {
				buttonEl.style.background = 'transparent'
				buttonEl.style.color = 'var(--text-muted)'
				buttonEl.style.transform = 'scale(1)'
			})

			// Set icon
			setIcon(buttonEl, action.icon)

			// Add click handler
			buttonEl.addEventListener('click', (e) => {
				e.stopPropagation()
				if (this.selectedNode) {
					action.action(this.selectedNode)
				}
				this.hide()
			})

			if (this.tooltipEl) {
				this.tooltipEl.appendChild(buttonEl)
			}
		})
	}

	show(node: CanvasNode) {
		if (!this.tooltipEl) return

		// Check if there are any actions to show
		if (this.actions.length === 0) {
			console.debug('CanvasTooltip: No actions available, not showing tooltip')
			return
		}

		// Check if node and nodeEl exist
		const nodeEl = node?.nodeEl
		if (!nodeEl) {
			console.debug('CanvasTooltip: Node or nodeEl is missing', { node: !!node, nodeEl: !!nodeEl })
			return
		}

		this.selectedNode = node

		// Position the tooltip at the upper right corner of the node
		const nodeRect = nodeEl.getBoundingClientRect()
		const containerRect = this.containerEl.getBoundingClientRect()

		// Calculate position relative to container
		const left = nodeRect.right - containerRect.left + 8
		const top = nodeRect.top - containerRect.top - 8

		console.debug('CanvasTooltip: Positioning tooltip', {
			nodeRect,
			containerRect,
			left,
			top,
			actionsCount: this.actions.length
		})

		this.tooltipEl.style.left = `${left}px`
		this.tooltipEl.style.top = `${top}px`
		this.tooltipEl.style.display = 'flex'

		// Trigger animation
		requestAnimationFrame(() => {
			if (this.tooltipEl) {
				this.tooltipEl.style.opacity = '1'
				this.tooltipEl.style.transform = 'translateY(0)'
				console.debug('CanvasTooltip: Animation triggered, tooltip should be visible')
			}
		})
	}

	hide() {
		if (!this.tooltipEl) return

		this.tooltipEl.style.opacity = '0'
		this.tooltipEl.style.transform = 'translateY(10px)'

		setTimeout(() => {
			if (this.tooltipEl) {
				this.tooltipEl.style.display = 'none'
			}
		}, 200)

		this.selectedNode = null
	}

	destroy() {
		if (this.tooltipEl) {
			this.tooltipEl.remove()
			this.tooltipEl = null
		}
		this.selectedNode = null
	}
}
