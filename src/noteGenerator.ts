/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { TiktokenModel, encodingForModel } from 'js-tiktoken'
import { App, ItemView, Notice } from 'obsidian'
import { CanvasNode } from './obsidian/canvas-internal'
import { CanvasView, calcHeight, createNode, createGroup, updateGroup } from './obsidian/canvas-patches'
import {
	CHAT_MODELS,
	chatModelByName,
	ChatModelSettings,
	getChatGPTStreamingCompletion
} from './openai/chatGPT'
import {
	GEMINI_MODELS,
	getGeminiStreamingCompletion
} from './gemini/geminiAPI'
import { openai } from './openai/chatGPT-types'
import {
	InfoverseAICanvasSettings,
	DEFAULT_SETTINGS
} from './settings/InfoverseAICanvasSettings'
import { Logger } from './util/logging'
import { visitNodeAndAncestors } from './obsidian/canvasUtil'
import { readNodeContent } from './obsidian/fileUtil'

/**
 * Color for assistant notes: 6 == purple
 */
const assistantColor = '6'

/**
 * Height to use for placeholder note
 */
const placeholderNoteHeight = 60

/**
 * Height to use for new empty note
 */
const emptyNoteHeight = 100

/**
 * Sleep utility function
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Represents a node in the hierarchical tree structure
 */
interface TreeNode {
	id: string
	content: string
	headerLevel: number
	headerText: string
	startIndex: number
	endIndex: number
	parentId?: string
	children: TreeNode[]
	canvasNode?: CanvasNode
}

/**
 * StreamingHandler manages real-time text streaming with header-based live splitting
 */
class StreamingHandler {
	private currentText = ''
	private currentNode: CanvasNode | null = null
	private canvas: any
	private parentNode: CanvasNode
	private lastUpdateTime = 0
	private isCompleted = false
	private pendingUpdate = false
	private isPaused = false
	private retryCount = 0
	private startTime = 0
	private tokenCount = 0
	private errorCount = 0
	private progressNode: CanvasNode | null = null
	private controlNode: CanvasNode | null = null

	// Header-based tree splitting properties
	private treeRoot: TreeNode | null = null
	private nodeMap = new Map<string, TreeNode>()
	private lastProcessedLength = 0
	private enableLiveSplitting = false
	private nodeCounter = 0
	// Dynamic hierarchy tracking
	private firstHeaderLevel: number | null = null // level (1-6) of the first header we encounter
	private topLevelCurrent: TreeNode | null = null // last node at firstHeaderLevel to attach children to

	// ---------------------------------------------------------------------
	// Radial layout helpers (streaming)
	// ---------------------------------------------------------------------
	private baseRadius() {
		// Default hierarchy spacing constant (was markdownHierarchySpacing setting)
		return 300
	}

	/** Compute depth of a tree node (root=0) */
	private getDepth(node: TreeNode): number {
		let depth = 0
		let current: TreeNode | undefined = node
		while (current && current.parentId) {
			const parent = this.nodeMap.get(current.parentId)
			if (!parent) break
			depth++
			current = parent
		}
		return depth
	}

	/**
	 * Arrange children of the given parentTreeNode in a radial fashion and
	 * recursively process deeper levels. Runs lightweight on every new header.
	 */
	private applyRadialLayout(parentTreeNode: TreeNode) {
		const parentCanvas: CanvasNode = parentTreeNode.canvasNode || this.parentNode
		if (!parentCanvas) return // safety

		const children = parentTreeNode.children.filter(c => c.canvasNode)
		if (children.length === 0) return

		const n = children.length

		// ------------------------------------------------------------------
		// Custom angle mapping for the first five root-level children so
		// that their positions match the exact sequence requested by the
		// user.  For any deeper levels or n > 5 we keep using the regular
		// even-spacing algorithm.
		// ------------------------------------------------------------------
		const getAngleSequence = (num: number): number[] => {
			if (num === 1) return [0]

			// Mirrored left-right ordering to keep the layout visually balanced.
			// Example (n = 6): 0°, 180°, 60°, 240°, 120°, 300°
			const increment = (2 * Math.PI) / num
			const bases = Array.from({ length: num }, (_v, i) => i * increment)
			const ordered: number[] = []
			while (bases.length) {
				ordered.push(bases.shift()!)
				if (bases.length) {
					ordered.push(bases.pop()!)
				}
			}
			return ordered
		}

		const angles = getAngleSequence(n)

		// We still need a generic increment value for certain geometric
		// calculations even when we use a custom sequence.
		const angleIncrement = n === 1 ? 0 : (2 * Math.PI) / n

		// Size-aware radius calculation --------------------------------------------------
		const margin = 40
		// --- Determine dimensions -------------------------------------------------
		const maxChildWidth = Math.max(...children.map(c => c.canvasNode!.width))
		const maxChildHeight = Math.max(...children.map(c => c.canvasNode!.height))
		// Half-diagonals (distance from center to farthest corner)
		const childHalfDiag = Math.sqrt(Math.pow(maxChildWidth / 2, 2) + Math.pow(maxChildHeight / 2, 2))
		const parentHalfDiag = Math.sqrt(Math.pow(parentCanvas.width / 2, 2) + Math.pow(parentCanvas.height / 2, 2))
		// a) radius so that children don't overlap each other (circle-packing)
		const childCircleRadius = n === 1 ? 0 : (childHalfDiag * 2 + margin) / (2 * Math.sin(angleIncrement / 2))
		// b) radius so that children clear the parent completely
		const parentClearRadius = parentHalfDiag + childHalfDiag + margin
		const minRadius = Math.max(childCircleRadius, parentClearRadius)
		// c) User-configurable base radius scaled by hierarchy depth
		const depthLevel = this.getDepth(parentTreeNode) + 1 // children are one level deeper
		const baseDepthRadius = this.baseRadius() + (depthLevel - 1) * 150
		// Final radius meets all constraints
		let radius = Math.max(baseDepthRadius, minRadius)

		// Give extra breathing space when we have many children (default-case path)
		if (n > 5) {
			radius *= 1.2
		}

		children.forEach((child, idx) => {
			const angle = angles[idx % angles.length]
			let newX = parentCanvas.x + radius * Math.cos(angle)
			let newY = parentCanvas.y + radius * Math.sin(angle)

			// Clamp to a reasonable viewport (avoid negative off-canvas positions)
			newX = Math.max(50, newX)
			newY = Math.max(0, newY)

			child.canvasNode!.moveAndResize({
				x: newX,
				y: newY,
				width: child.canvasNode!.width,
				height: child.canvasNode!.height
			})

			// Recursive layout for grandchildren
			if (child.children.length) {
				this.applyRadialLayout(child)
			}
		})
	}

	constructor(
		canvas: any,
		parentNode: CanvasNode,
		initialNode: CanvasNode,
		private settings: InfoverseAICanvasSettings,
		private logDebug: Logger
	) {
		this.canvas = canvas
		this.parentNode = parentNode
		this.currentNode = initialNode
		this.startTime = Date.now()
		this.enableLiveSplitting = false

		// Debug log the initialization
		this.logDebug(`StreamingHandler initialized:`, {
			enableStreamingSplit: settings.enableStreamingSplit,
			enableLiveSplitting: this.enableLiveSplitting
		})

		// Initialize the tree structure if live splitting is enabled
		if (this.enableLiveSplitting) {
			this.initializeTreeStructure(initialNode)
			this.logDebug('Header-based live splitting enabled, tree structure initialized')
		}

		// Initialize progress tracking if enabled
		if (this.settings.showStreamingProgress) {
			this.createProgressIndicator()
		}

		// Initialize streaming controls if enabled
		if (this.settings.enableStreamingControls) {
			this.createStreamingControls()
		}
	}

	/**
	 * Initialize the tree structure with the initial node
	 */
	private initializeTreeStructure(initialNode: CanvasNode) {
		this.treeRoot = {
			id: `node-${this.nodeCounter++}`,
			content: '',
			headerLevel: 0,
			headerText: 'Root',
			startIndex: 0,
			endIndex: 0,
			children: [],
			canvasNode: initialNode
		}
		this.nodeMap.set(this.treeRoot.id, this.treeRoot)
		this.logDebug('Tree structure initialized with root node')
	}

	/**
	 * Get current text for external access
	 */
	getCurrentText(): string {
		return this.currentText
	}

	/**
	 * Create a progress indicator node
	 */
	private createProgressIndicator() {
		try {
			const progressText = this.enableLiveSplitting
				? '📊 Streaming with header-based splitting: 0 tokens, 0 chars/sec'
				: '📊 Streaming: 0 tokens, 0 chars/sec'

			this.progressNode = createNode(
				this.canvas,
				this.parentNode,
				{
					text: progressText,
					size: { height: 60 }
				},
				{
					color: '3', // Yellow for progress
					chat_role: 'system'
				}
			)
		} catch (error) {
			this.logDebug('Failed to create progress indicator:', error)
		}
	}

	/**
	 * Update progress indicator
	 */
	private updateProgress() {
		if (!this.progressNode || !this.settings.showStreamingProgress) return

		const elapsed = (Date.now() - this.startTime) / 1000
		const charRate = elapsed > 0 ? Math.round(this.currentText.length / elapsed) : 0
		const nodeCount = this.nodeMap.size

		let progressText = this.enableLiveSplitting
			? `📊 Header-Based Streaming: ${this.tokenCount} tokens | ${nodeCount} nodes | ${charRate} chars/sec`
			: `📊 Streaming: ${this.tokenCount} tokens | ${this.currentText.length} chars | ${charRate} chars/sec`

		if (this.settings.enableStreamingMetrics) {
			const errorRate = this.errorCount > 0 ? `| ${this.errorCount} errors` : ''
			const retryInfo = this.retryCount > 0 ? `| ${this.retryCount} retries` : ''
			progressText += ` ${errorRate} ${retryInfo}`
		}

		this.progressNode.setText(progressText)
	}

	/**
	 * Parse headers from markdown text and return header information
	 */
	private parseHeaders(text: string): Array<{
		level: number
		text: string
		startIndex: number
		endIndex: number
		fullLine: string
	}> {
		const headers: Array<{
			level: number
			text: string
			startIndex: number
			endIndex: number
			fullLine: string
		}> = []

		const lines = text.split('\n')
		let currentIndex = 0

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)

			if (headerMatch) {
				const level = headerMatch[1].length
				const headerText = headerMatch[2].trim()

				headers.push({
					level,
					text: headerText,
					startIndex: currentIndex,
					endIndex: currentIndex + line.length,
					fullLine: line
				})
			}

			currentIndex += line.length + 1 // +1 for newline
		}

		return headers
	}

	/**
	 * Check for new headers and split content accordingly
	 */
	private async tryHeaderBasedSplit() {
		if (!this.enableLiveSplitting || this.currentText.length <= this.lastProcessedLength) {
			return
		}

		const allHeaders = this.parseHeaders(this.currentText)

		this.logDebug(`Checking for new headers. Total headers found: ${allHeaders.length}`)

		// Find headers that are in the new content
		const newHeaders = allHeaders.filter(header =>
			header.startIndex >= this.lastProcessedLength
		)

		if (newHeaders.length === 0) {
			// No new headers, just update the current node
			this.updateCurrentActiveNode()
			return
		}

		this.logDebug(`Found ${newHeaders.length} new headers:`, newHeaders.map(h => `${h.level}: ${h.text}`))

		// Process each new header
		for (const header of newHeaders) {
			await this.processNewHeader(header)
		}

		this.lastProcessedLength = this.currentText.length
	}

	/**
	 * Process a new header by creating appropriate tree nodes
	 */
	private async processNewHeader(header: {
		level: number
		text: string
		startIndex: number
		endIndex: number
		fullLine: string
	}) {
		// Determine allowed depth dynamically
		if (this.firstHeaderLevel === null) {
			this.firstHeaderLevel = header.level
		}

		const maxAllowedLevel = this.firstHeaderLevel + 1
		if (header.level > maxAllowedLevel) {
			return // ignore deeper headers
		}

		try {
			// Decide parent based on dynamic flat hierarchy rules
			let parentTreeNode: TreeNode | null
			if (header.level === this.firstHeaderLevel) {
				parentTreeNode = this.treeRoot
			} else {
				// header.level == firstHeaderLevel + 1
				parentTreeNode = this.topLevelCurrent || this.treeRoot
			}

			if (!parentTreeNode) {
				this.logDebug('No parent available for new header, skipping')
				return
			}

			// Find content before header and update previous node
			const contentBeforeHeader = this.currentText.slice(this.lastProcessedLength, header.startIndex).trim()

			// ---------------------------------------------------------------------
			// Root-note fix: if the very first header starts at index 0 we know that
			// there is no real root-level content.  The original placeholder canvas
			// node would otherwise keep showing "Calling AI…" (or similar) and later
			// get filled with the complete text, effectively duplicating content.
			//
			// We therefore remove (or clear) the visual root node and demote the
			// treeRoot so that it will never be selected by
			// getCurrentActiveTreeNode() again.
			// ---------------------------------------------------------------------
			if (header.startIndex === 0 && this.treeRoot && this.nodeMap.size === 1) {
				try {
					if (this.treeRoot.canvasNode) {
						// Remove only the visual element – the logical root stays for hierarchy
						this.canvas.removeNode(this.treeRoot.canvasNode)
						this.treeRoot.canvasNode = undefined
					}
					// Ensure root is not treated as the most recent node anymore
					this.treeRoot.startIndex = -1
					this.logDebug('Root placeholder removed after first header at index 0')
				} catch (cleanupErr) {
					this.logDebug('Failed to remove root placeholder', cleanupErr)
				}
			}

			if (contentBeforeHeader.length > 0) {
				this.updateCurrentActiveNode()
			}

			const newTreeNode: TreeNode = {
				id: `node-${this.nodeCounter++}`,
				content: '',
				headerLevel: header.level,
				headerText: header.text,
				startIndex: header.startIndex,
				endIndex: header.endIndex,
				parentId: parentTreeNode.id,
				children: []
			}

			// Attach to parent and update maps
			parentTreeNode.children.push(newTreeNode)
			await this.createCanvasNodeForTreeNode(newTreeNode, parentTreeNode)
			this.nodeMap.set(newTreeNode.id, newTreeNode)

			// Update top-level tracker
			if (header.level === this.firstHeaderLevel) {
				this.topLevelCurrent = newTreeNode
			}

			// After creating the node, apply radial layout on its parent to keep
			// siblings evenly distributed during streaming.
			this.applyRadialLayout(parentTreeNode)

			this.logDebug(`Created tree node for header: "${header.text}" (level ${header.level})`)

		} catch (error) {
			this.logDebug('Error processing new header:', error)
		}
	}

	/**
	 * Find the appropriate parent node for a given header level
	 */
	private findParentForLevel(headerLevel: number): TreeNode | null {
		if (!this.treeRoot || headerLevel <= 1) {
			return this.treeRoot
		}

		// Find the most recent node at a higher level (lower number)
		const nodes = Array.from(this.nodeMap.values())
		const candidateParents = nodes.filter(node =>
			node.headerLevel < headerLevel && node.headerLevel > 0
		)

		if (candidateParents.length === 0) {
			return this.treeRoot
		}

		// Sort by start index to get the most recent parent
		candidateParents.sort((a, b) => b.startIndex - a.startIndex)
		return candidateParents[0]
	}

	/**
	 * Create a canvas node for a tree node
	 */
	private async createCanvasNodeForTreeNode(treeNode: TreeNode, parentTreeNode: TreeNode | null) {
		try {
			// Determine color based on header level
			const color = this.getNodeColorByLevel(treeNode.headerLevel)

			// Calculate position in the tree layout
			const position = this.calculateTreePosition(treeNode, parentTreeNode)

			// Create initial content with just the header
			const initialContent = treeNode.headerLevel > 0
				? '#'.repeat(treeNode.headerLevel) + ' ' + treeNode.headerText
				: treeNode.headerText

			// Create canvas node
			const canvasNode = createNode(
				this.canvas,
				parentTreeNode?.canvasNode || this.parentNode,
				{
					text: initialContent,
					size: {
						height: calcHeight({
							text: initialContent,
							parentHeight: this.parentNode.height
						})
					}
				},
				{
					color: color,
					chat_role: 'assistant'
				}
			)

			// Position the node
			canvasNode.moveAndResize({
				x: position.x,
				y: position.y,
				width: 400,
				height: canvasNode.height
			})

			// Store reference in tree node
			treeNode.canvasNode = canvasNode

			// Create edge if hierarchy is enabled and there's a parent
			if (parentTreeNode?.canvasNode) {
				try {
					const sides = this.getEdgeSides(parentTreeNode.canvasNode, canvasNode)
						; (this.canvas as any).createEdge?.(parentTreeNode.canvasNode, canvasNode, sides)
					this.logDebug('Created edge between nodes')
				} catch (edgeError) {
					this.logDebug('Edge creation failed', edgeError)
				}
			}

			this.logDebug(`Created canvas node for "${treeNode.headerText}" at position (${position.x}, ${position.y})`)

		} catch (error) {
			this.logDebug('Failed to create canvas node for tree node:', error)
		}
	}

	/**
	 * Get node color based on header level
	 */
	private getNodeColorByLevel(level: number): string {
		switch (level) {
			case 0: return '2' // Orange for root content
			case 1: return '1' // Red for H1
			case 2: return '4' // Green for H2
			case 3: return '5' // Purple for H3
			case 4: return '6' // Pink for H4
			case 5: return '3' // Yellow for H5
			case 6: return assistantColor // Default purple for H6
			default: return assistantColor
		}
	}

	/**
	 * Calculate position for a tree node in canvas space
	 */
	private calculateTreePosition(treeNode: TreeNode, parentTreeNode: TreeNode | null): { x: number, y: number } {
		const baseX = this.parentNode.x
		const baseY = this.parentNode.y + this.parentNode.height + 100

		if (!parentTreeNode || !parentTreeNode.canvasNode) {
			// Root level - arrange vertically
			const siblingIndex = this.treeRoot?.children.indexOf(treeNode) || 0
			return {
				x: baseX,
				y: baseY + (siblingIndex * 250)
			}
		}

		// Child node - position relative to parent
		const parentPos = {
			x: parentTreeNode.canvasNode.x,
			y: parentTreeNode.canvasNode.y
		}

		const siblings = parentTreeNode.children
		const siblingIndex = siblings.indexOf(treeNode)

		// Position children to the right of parent
		const horizontalSpacing = 450
		const verticalSpacing = 200

		return {
			x: parentPos.x + horizontalSpacing,
			y: parentPos.y + (siblingIndex * verticalSpacing)
		}
	}

	/**
	 * Update the currently active node (the last created node or root)
	 */
	private updateCurrentActiveNode() {
		if (!this.enableLiveSplitting) {
			// Single node mode
			if (this.currentNode) {
				const displayText = this.isCompleted ? this.currentText : `${this.currentText}●`
				this.currentNode.setText(displayText)
				this.resizeNode(this.currentNode, displayText)
			}
			return
		}

		// Tree mode - update the most recent node that should contain current content
		const currentActiveNode = this.getCurrentActiveTreeNode()
		if (!currentActiveNode?.canvasNode) {
			return
		}

		// Get content for this node (from its start to current position or next header)
		const nodeContent = this.getContentForTreeNode(currentActiveNode)
		const displayText = this.isCompleted ? nodeContent : `${nodeContent}●`

		currentActiveNode.canvasNode.setText(displayText)
		this.resizeNode(currentActiveNode.canvasNode, displayText)

		// Update the tree node's content and end index
		currentActiveNode.content = nodeContent
		currentActiveNode.endIndex = currentActiveNode.startIndex + nodeContent.length
	}

	/**
	 * Get the current active tree node (where new content should be added)
	 */
	private getCurrentActiveTreeNode(): TreeNode | null {
		if (!this.treeRoot) return null

		// Consider only nodes that still have a visible canvas element
		const allNodes = Array.from(this.nodeMap.values()).filter(n => n.canvasNode)
		if (allNodes.length === 0) return this.treeRoot

		allNodes.sort((a, b) => b.startIndex - a.startIndex)
		return allNodes[0]
	}

	/**
	 * Get content that belongs to a specific tree node
	 */
	private getContentForTreeNode(treeNode: TreeNode): string {
		if (!treeNode) return ''

		const startIndex = treeNode.startIndex
		let endIndex = this.currentText.length

		// Find the next header at the same or higher level to determine where this content ends
		const allHeaders = this.parseHeaders(this.currentText)
		for (const header of allHeaders) {
			if (header.startIndex <= startIndex) continue

			// Special-case root: stop at the very first header of ANY level
			if (treeNode.headerLevel === 0) {
				endIndex = header.startIndex
				break
			}

			// For non-root nodes end right before the *next* header that is either
			//  • the same level (another sibling)
			//  • or exactly one level deeper (its first child)
			// This prevents the parent from including the child header text itself.
			if (header.level <= treeNode.headerLevel + 1) {
				endIndex = header.startIndex
				break
			}
		}

		return this.currentText.slice(startIndex, endIndex).trim()
	}

	/**
	 * Resize a canvas node based on its content
	 */
	private resizeNode(canvasNode: CanvasNode, text: string) {
		const newHeight = calcHeight({
			text: text,
			parentHeight: this.parentNode.height
		})

		canvasNode.moveAndResize({
			height: newHeight,
			width: canvasNode.width,
			x: canvasNode.x,
			y: canvasNode.y
		})
	}

	/**
	 * Pause streaming
	 */
	pause() {
		if (this.settings.enableStreamingControls) {
			this.isPaused = true
			this.updateStreamingControls()
			this.logDebug('Streaming paused')
		}
	}

	/**
	 * Resume streaming
	 */
	resume() {
		if (this.settings.enableStreamingControls) {
			this.isPaused = false
			this.updateStreamingControls()
			this.logDebug('Streaming resumed')
		}
	}

	/**
	 * Handle incoming token from streaming API
	 */
	onToken = async (token: string) => {
		if (this.isCompleted || this.isPaused) return

		this.currentText += token
		this.tokenCount++

		// Debug every 10 tokens to avoid spam
		if (this.tokenCount % 10 === 0) {
			this.logDebug(`Token ${this.tokenCount}: currentText.length = ${this.currentText.length}`)
		}

		// Update progress
		this.updateProgress()

		// Throttled updates to prevent overwhelming the UI
		const now = Date.now()
		if (now - this.lastUpdateTime >= this.settings.streamingUpdateInterval && !this.pendingUpdate) {
			this.pendingUpdate = true
			this.scheduleUpdate()
		}
	}

	/**
	 * Handle completion of streaming
	 */
	onComplete = (fullText: string) => {
		this.isCompleted = true
		this.currentText = fullText

		// Schedule async operations without blocking the completion callback
		this.scheduleAsyncCompletion()

		// Final update to remove streaming indicator
		this.updateCurrentActiveNode()
		this.updateProgress()

		// Clean up control nodes
		if (this.controlNode) {
			setTimeout(() => {
				if (this.controlNode) {
					this.canvas.removeNode(this.controlNode)
					this.controlNode = null
				}
			}, 1000) // Remove after 1 second
		}

		// Clean up progress indicator
		if (this.progressNode) {
			setTimeout(() => {
				if (this.progressNode) {
					this.canvas.removeNode(this.progressNode)
					this.progressNode = null
				}
			}, 2000) // Remove after 2 seconds
		}

		const nodeCount = this.enableLiveSplitting ? this.nodeMap.size : 1
		this.logDebug(`Streaming completed with ${this.tokenCount} tokens across ${nodeCount} nodes`)
	}

	/**
	 * Handle async operations after completion
	 */
	private async scheduleAsyncCompletion() {
		try {
			// Final processing for any remaining content
			if (this.enableLiveSplitting) {
				await this.tryHeaderBasedSplit()
				this.updateCurrentActiveNode()
			}
		} catch (error) {
			this.logDebug('Error in async completion:', error)
		}
	}

	/**
	 * Handle streaming errors with retry logic
	 */
	onError = (error: Error) => {
		this.errorCount++
		this.logDebug(`Streaming error (attempt ${this.retryCount + 1}):`, error)

		// Auto-retry if enabled and within retry limit
		if (this.retryCount < this.settings.streamingRetryAttempts) {
			this.retryCount++
			this.logDebug(`Retrying streaming (attempt ${this.retryCount}/${this.settings.streamingRetryAttempts})`)

			// Update progress to show retry
			this.updateProgress()

			// Don't complete on retryable errors
			return
		}

		// Final error after all retries
		this.isCompleted = true

		// Update the node to remove streaming indicator and show error
		if (this.currentNode) {
			this.currentNode.setText(`❌ Streaming failed after ${this.retryCount} retries: ${error.message}`)
		}

		// Update progress indicator
		this.updateProgress()

		// Clean up progress indicator
		if (this.progressNode) {
			this.progressNode.setText(`❌ Streaming failed: ${error.message}`)
			setTimeout(() => {
				if (this.progressNode) {
					this.canvas.removeNode(this.progressNode)
					this.progressNode = null
				}
			}, 5000)
		}

		console.error('Streaming error:', error)
	}

	/**
	 * Schedule a throttled update
	 */
	private scheduleUpdate() {
		setTimeout(() => {
			this.updateCurrentActiveNode()
			this.lastUpdateTime = Date.now()
			this.pendingUpdate = false
		}, Math.max(0, this.settings.streamingUpdateInterval - (Date.now() - this.lastUpdateTime)))
	}

	/**
	 * Create streaming control buttons if enabled
	 */
	private createStreamingControls() {
		if (!this.settings.enableStreamingControls) return

		try {
			// Create control panel node
			const controlText = this.isPaused ? '▶️ Resume | ⏹️ Stop' : '⏸️ Pause | ⏹️ Stop'

			const controlNode = createNode(
				this.canvas,
				this.parentNode,
				{
					text: `🎛️ Streaming Controls\n${controlText}\n\nClick to interact`,
					size: { height: 80 }
				},
				{
					color: '4', // Green for controls
					chat_role: 'system'
				}
			)

			// Store reference for updates
			this.controlNode = controlNode

			// Note: In a real implementation, you'd need to add click handlers
			// This is a simplified version showing the concept
		} catch (error) {
			this.logDebug('Failed to create streaming controls:', error)
		}
	}

	/**
	 * Update streaming control buttons
	 */
	private updateStreamingControls() {
		if (!this.controlNode || !this.settings.enableStreamingControls) return

		const controlText = this.isPaused ? '▶️ Resume | ⏹️ Stop' : '⏸️ Pause | ⏹️ Stop'
		const statusText = this.isPaused ? '(Paused)' : '(Streaming...)'

		this.controlNode.setText(`🎛️ Streaming Controls ${statusText}\n${controlText}\n\nClick to interact`)
	}

	/**
	 * Force completion if streaming gets stuck
	 */
	forceCompletion(reason = 'Force completion'): void {
		if (!this.isCompleted) {
			console.warn(`StreamingHandler: ${reason}`)
			this.onComplete(this.currentText || '')
		}
	}

	/**
	 * Stop streaming completely
	 */
	stop() {
		this.isCompleted = true
		this.isPaused = false

		// Update final state
		this.updateCurrentActiveNode()
		this.updateProgress()

		// Clean up control nodes immediately
		if (this.controlNode) {
			this.canvas.removeNode(this.controlNode)
			this.controlNode = null
		}

		// Clean up progress indicator immediately
		if (this.progressNode) {
			this.canvas.removeNode(this.progressNode)
			this.progressNode = null
		}
	}

	/**
	 * Get the tree structure for debugging or external use
	 */
	getTreeStructure(): TreeNode | null {
		return this.treeRoot
	}

	/**
	 * Get a visualization of the current tree structure
	 */
	getTreeVisualization(): string {
		if (!this.treeRoot) return 'No tree structure available'

		const lines: string[] = []

		const renderNode = (node: TreeNode, depth = 0) => {
			const indent = '  '.repeat(depth)
			const icon = node.headerLevel === 0 ? '🌳' :
				node.headerLevel === 1 ? '📚' :
					node.headerLevel === 2 ? '📖' : '📝'
			const prefix = node.headerLevel > 0 ? '#'.repeat(node.headerLevel) + ' ' : ''
			lines.push(`${indent}${icon} ${prefix}${node.headerText} (${node.content.length} chars)`)

			node.children.forEach(child => {
				renderNode(child, depth + 1)
			})
		}

		renderNode(this.treeRoot)
		return lines.join('\n')
	}

	private getEdgeSides(parent: CanvasNode, child: CanvasNode) {
		// Get all existing edges to check for crossings
		const existingEdges = this.getExistingEdges()

		// Calculate connection points for all four sides of each node
		const getConnectionPoints = (node: CanvasNode) => {
			const centerX = node.x + node.width / 2
			const centerY = node.y + node.height / 2

			return {
				top: { x: centerX, y: node.y },
				bottom: { x: centerX, y: node.y + node.height },
				left: { x: node.x, y: centerY },
				right: { x: node.x + node.width, y: centerY }
			}
		}

		// Check if two line segments intersect
		const linesIntersect = (p1: { x: number, y: number }, p2: { x: number, y: number },
			p3: { x: number, y: number }, p4: { x: number, y: number }): boolean => {
			const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y)
			if (denominator === 0) return false // parallel lines

			const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator
			const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator

			return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1
		}

		// Check if a potential edge would cross any existing edges
		const wouldCross = (fromPoint: { x: number, y: number }, toPoint: { x: number, y: number }): boolean => {
			for (const edge of existingEdges) {
				if (linesIntersect(fromPoint, toPoint, edge.from, edge.to)) {
					return true
				}
			}
			return false
		}

		// Calculate path cost considering distance and crossings
		const calculatePathCost = (fromPoint: { x: number, y: number }, toPoint: { x: number, y: number }): number => {
			const distance = Math.sqrt(
				Math.pow(toPoint.x - fromPoint.x, 2) +
				Math.pow(toPoint.y - fromPoint.y, 2)
			)

			// Heavy penalty for crossing existing edges
			const crossingPenalty = wouldCross(fromPoint, toPoint) ? distance * 10 : 0

			return distance + crossingPenalty
		}

		const fromPoints = getConnectionPoints(parent)
		const toPoints = getConnectionPoints(child)

		// Find the best connection that minimizes crossings and distance
		let minCost = Infinity
		let bestConnection = { fromSide: 'right', toSide: 'left' }

		const sides = ['top', 'bottom', 'left', 'right'] as const

		for (const fromSide of sides) {
			for (const toSide of sides) {
				const fromPoint = fromPoints[fromSide]
				const toPoint = toPoints[toSide]

				const cost = calculatePathCost(fromPoint, toPoint)

				if (cost < minCost) {
					minCost = cost
					bestConnection = { fromSide, toSide }
				}
			}
		}

		return bestConnection
	}

	/**
	 * Get existing edges from the canvas to check for crossings
	 */
	private getExistingEdges(): Array<{ from: { x: number, y: number }, to: { x: number, y: number } }> {
		try {
			const canvasData = (this.canvas as any).getData?.()
			if (!canvasData?.edges) return []

			const edges: Array<{ from: { x: number, y: number }, to: { x: number, y: number } }> = []

			for (const edge of canvasData.edges) {
				const fromNode = canvasData.nodes?.find((n: any) => n.id === edge.fromNode)
				const toNode = canvasData.nodes?.find((n: any) => n.id === edge.toNode)

				if (fromNode && toNode) {
					// Calculate actual connection points based on edge sides
					const fromPoint = this.getActualConnectionPoint(fromNode, edge.fromSide || 'right')
					const toPoint = this.getActualConnectionPoint(toNode, edge.toSide || 'left')

					edges.push({ from: fromPoint, to: toPoint })
				}
			}

			return edges
		} catch (error) {
			this.logDebug('Failed to get existing edges:', error)
			return []
		}
	}

	/**
	 * Get the actual connection point for a node and side
	 */
	private getActualConnectionPoint(nodeData: any, side: string): { x: number, y: number } {
		const centerX = nodeData.x + nodeData.width / 2
		const centerY = nodeData.y + nodeData.height / 2

		switch (side) {
			case 'top': return { x: centerX, y: nodeData.y }
			case 'bottom': return { x: centerX, y: nodeData.y + nodeData.height }
			case 'left': return { x: nodeData.x, y: centerY }
			case 'right': return { x: nodeData.x + nodeData.width, y: centerY }
			default: return { x: centerX, y: centerY }
		}
	}
}

export function noteGenerator(
	app: App,
	settings: InfoverseAICanvasSettings,
	logDebug: Logger
) {
	// Store reference to the last streaming handler for debugging
	let lastStreamingHandler: StreamingHandler | null = null

	const canCallAI = () => {
		const provider = getProviderFromModel(settings.apiModel)
		const apiKey = provider === 'OpenAI' ? settings.openaiApiKey : settings.geminiApiKey

		if (!apiKey) {
			new Notice(`Please set your ${provider} API key in the plugin settings`)
			return false
		}

		return true
	}

	const nextNote = async () => {
		logDebug('Creating user note')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values()) as CanvasNode[]
		const node = values[0]

		if (node) {
			const created = createNode(canvas, node, {
				text: '',
				size: { height: emptyNoteHeight }
			})
			canvas.selectOnly(created, true /* startEditing */)

			// startEditing() doesn't work if called immediately
			await canvas.requestSave()
			await sleep(100)

			created.startEditing()
		}
	}

	const getActiveCanvas = () => {
		const maybeCanvasView = app.workspace.getActiveViewOfType(
			ItemView
		) as CanvasView | null
		return maybeCanvasView ? maybeCanvasView['canvas'] : null
	}

	const isSystemPromptNode = (text: string) =>
		text.trim().startsWith('SYSTEM PROMPT')

	const getSystemPrompt = async (node: CanvasNode) => {
		let foundPrompt: string | null = null

		await visitNodeAndAncestors(node, async (n: CanvasNode) => {
			const text = await readNodeContent(n)
			if (text && isSystemPromptNode(text)) {
				foundPrompt = text
				return false
			} else {
				return true
			}
		})

		return foundPrompt || settings.systemPrompt
	}

	const buildMessages = async (node: CanvasNode) => {
		const encoding = getEncoding(settings)

		const messages: openai.ChatCompletionRequestMessage[] = []
		let tokenCount = 0

		// Note: We are not checking for system prompt longer than context window.
		// That scenario makes no sense, though.
		const systemPrompt = await getSystemPrompt(node)
		if (systemPrompt) {
			tokenCount += encoding.encode(systemPrompt).length
		}

		const visit = async (node: CanvasNode, depth: number) => {
			if (settings.maxDepth && depth > settings.maxDepth) return false

			const nodeData = node.getData()
			let nodeText = (await readNodeContent(node))?.trim() || ''
			const inputLimit = getTokenLimit(settings)

			let shouldContinue = true
			if (!nodeText) {
				return shouldContinue
			}

			if (nodeText.startsWith('data:image')) {
				messages.unshift({
					content: [{
						'type': 'image_url',
						'image_url': { 'url': nodeText }
					}],
					role: 'user'
				})
			} else {
				if (isSystemPromptNode(nodeText)) return true

				const nodeTokens = encoding.encode(nodeText)
				let keptNodeTokens: number

				if (tokenCount + nodeTokens.length > inputLimit) {
					// will exceed input limit

					shouldContinue = false

					// Leaving one token margin, just in case
					const keepTokens = nodeTokens.slice(0, inputLimit - tokenCount - 1)
					const truncateTextTo = encoding.decode(keepTokens).length
					logDebug(
						`Truncating node text from ${nodeText.length} to ${truncateTextTo} characters`
					)
					nodeText = nodeText.slice(0, truncateTextTo)
					keptNodeTokens = keepTokens.length
				} else {
					keptNodeTokens = nodeTokens.length
				}

				tokenCount += keptNodeTokens

				const role: openai.ChatCompletionRequestMessageRoleEnum =
					nodeData.chat_role === 'assistant' ? 'assistant' : 'user'

				messages.unshift({
					content: nodeText,
					role
				})
			}

			return shouldContinue
		}

		await visitNodeAndAncestors(node, visit)

		if (messages.length) {
			if (systemPrompt) {
				messages.unshift({
					content: systemPrompt,
					role: 'system'
				})
			}

			return { messages, tokenCount }
		} else {
			return { messages: [], tokenCount: 0 }
		}
	}

	// Streaming API call function
	const callAIStreaming = async (
		messages: openai.ChatCompletionRequestMessage[],
		onToken: (token: string) => void,
		onComplete: (fullText: string) => void,
		onError: (error: Error) => void
	): Promise<void> => {
		const provider = getProviderFromModel(settings.apiModel)
		const apiKey = provider === 'OpenAI' ? settings.openaiApiKey : settings.geminiApiKey

		if (provider === 'Gemini') {
			return await getGeminiStreamingCompletion(
				apiKey,
				settings.apiModel,
				messages.map(msg => ({
					role: msg.role,
					content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
				})),
				onToken,
				onComplete,
				onError,
				{
					temperature: settings.temperature,
					maxOutputTokens: settings.maxResponseTokens || undefined
				}
			)
		} else {
			// Default to OpenAI with timeout support
			return await getChatGPTStreamingCompletion(
				apiKey,
				settings.apiUrl,
				settings.apiModel,
				messages,
				onToken,
				onComplete,
				onError,
				{
					max_tokens: settings.maxResponseTokens || undefined,
					temperature: settings.temperature
				},
				settings.streamingTimeout || 30000 // Use timeout from settings
			)
		}
	}

	// Helper function to determine provider from model name
	const getProviderFromModel = (modelName: string): string => {
		const isGeminiModel = Object.values(GEMINI_MODELS).some(model => model.name === modelName)
		return isGeminiModel ? 'Gemini' : 'OpenAI'
	}

	const generateNote = async () => {
		if (!canCallAI()) {
			return
		}

		logDebug('Creating AI note')


		const canvas = getActiveCanvas()

		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) {
			return // TODO: handle multiple nodes
		}

		const values = Array.from(selection.values())
		const node = values[0]

		if (node) {
			// Last typed characters might not be applied to note yet
			await canvas.requestSave()
			await sleep(200)

			const { messages, tokenCount } = await buildMessages(node)

			if (!messages.length) {
				return
			}

			const created = createNode(
				canvas,
				node,
				{
					text: `Calling AI (${settings.apiModel})...`,
					size: { height: placeholderNoteHeight }
				},
				{
					color: assistantColor,
					chat_role: 'assistant'
				}
			)

			new Notice(
				`Sending ${messages.length} notes with ${tokenCount} tokens to AI`
			)

			try {
				logDebug('messages', messages)

				// For the "Generate single AI response" action we force-disable
				// markdown splitting so that the reply stays in one note even if
				// the user has global splitting turned on in plugin settings.
				const singleResponseSettings = {
					...settings,
					enableStreamingSplit: false
				} as typeof settings

				const streamingHandler = new StreamingHandler(
					canvas,
					node,
					created,
					singleResponseSettings,
					logDebug
				)

				// Store reference for debugging
				lastStreamingHandler = streamingHandler

				new Notice(`Streaming ${settings.apiModel} response...`)

				// Add timeout fallback to ensure completion is always called
				let isStreamingCompleted = false
				const maxStreamingTimeout = (settings.streamingTimeout || 30000) + 10000 // Add 10s buffer

				const timeoutId = setTimeout(() => {
					if (!isStreamingCompleted) {
						console.warn('Streaming timeout reached, forcing completion')
						streamingHandler.onComplete(streamingHandler.getCurrentText() || 'Streaming timed out')
						isStreamingCompleted = true
					}
				}, maxStreamingTimeout)

				// Wrap the onComplete callback to ensure cleanup
				const originalOnComplete = streamingHandler.onComplete
				streamingHandler.onComplete = (fullText: string) => {
					if (!isStreamingCompleted) {
						isStreamingCompleted = true
						clearTimeout(timeoutId)
						originalOnComplete(fullText)
					}
				}

				// Wrap the onError callback to ensure cleanup
				const originalOnError = streamingHandler.onError
				streamingHandler.onError = (error: Error) => {
					if (!isStreamingCompleted) {
						isStreamingCompleted = true
						clearTimeout(timeoutId)
						originalOnError(error)
					}
				}

				await callAIStreaming(
					messages,
					streamingHandler.onToken,
					streamingHandler.onComplete,
					streamingHandler.onError
				)

				// StreamingHandler manages the final state, so we can return here
				await canvas.requestSave()
				return

				// Note: Removed fallback to non-streaming mode since streaming is now always enabled
			} catch (error) {
				new Notice(`Error calling AI: ${error.message || error}`)
				canvas.removeNode(created)
			}

			await canvas.requestSave()
		}
	}

	const generateMindmap = async () => {
		if (!canCallAI()) return

		logDebug('Creating AI mind-map (H1 root + H2 children)')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values()) as CanvasNode[]
		const node = values[0]

		if (!node) return

		// Flush any in-progress edits on the selected node so we send the latest text
		await canvas.requestSave()
		await sleep(200)

		const { messages, tokenCount } = await buildMessages(node)
		if (!messages.length) return

		// Placeholder that will become the root note later
		const placeholder = createNode(
			canvas,
			node,
			{
				text: `Calling AI (${settings.apiModel})...`,
				size: { height: placeholderNoteHeight }
			},
			{
				color: assistantColor,
				chat_role: 'assistant'
			}
		)

		new Notice(`Sending ${messages.length} notes with ${tokenCount} tokens to AI`)

		//------------------------------------------------------------------
		// Optionally create a containing group (frame). If the user's
		// original note is already inside a group we reuse that group and
		// skip creating a new one.
		//------------------------------------------------------------------

		const isNodeInsideGroup = (canvasInst: any, n: CanvasNode): boolean => {
			try {
				const data = canvasInst.getData()
				if (!data?.nodes) return false
				return data.nodes
					.filter((gn: any) => gn.type === 'group')
					.some((g: any) => {
						const cx = n.x + n.width / 2
						const cy = n.y + n.height / 2
						return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height
					})
			} catch (_) {
				return false
			}
		}

		let groupId: string | null = null

		if (!isNodeInsideGroup(canvas, node)) {
			const initialGroupMargin = 100
			groupId = createGroup(canvas, {
				label: 'AI Mind-map',
				pos: {
					x: placeholder.x - initialGroupMargin,
					y: placeholder.y - initialGroupMargin
				},
				size: {
					width: placeholder.width + initialGroupMargin * 2,
					height: placeholder.height + initialGroupMargin * 2
				}
			})
		}

		//------------------------------------------------------------------
		// Stream into single note first, then split into mindmap after completion
		//------------------------------------------------------------------
		// Disable live-splitting so all content goes into one note during streaming
		const singleNoteSettings = {
			...settings,
			enableStreamingSplit: false
		} as typeof settings

		const streamingHandler = new StreamingHandler(
			canvas,
			node,
			placeholder,
			singleNoteSettings,
			logDebug
		)

		// Store reference for debug utilities
		lastStreamingHandler = streamingHandler

		// Post-processing function to split single note into mindmap
		const splitIntoMindmap = async (fullText: string, rootNode: CanvasNode) => {
			// Parse headers from the completed text
			const parseHeaders = (text: string) => {
				const headers: Array<{
					level: number
					text: string
					startIndex: number
					endIndex: number
					fullLine: string
				}> = []

				const lines = text.split('\n')
				let currentIndex = 0

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)

					if (headerMatch) {
						const level = headerMatch[1].length
						const headerText = headerMatch[2].trim()

						headers.push({
							level,
							text: headerText,
							startIndex: currentIndex,
							endIndex: currentIndex + line.length,
							fullLine: line
						})
					}

					currentIndex += line.length + 1 // +1 for newline
				}

				return headers
			}

			const headers = parseHeaders(fullText)
			if (headers.length === 0) {
				logDebug('No headers found, keeping single note')
				return [rootNode]
			}

			// Determine hierarchy levels (only use first 2 levels)
			const firstHeaderLevel = Math.min(...headers.map(h => h.level))
			const allowedLevels = [firstHeaderLevel, firstHeaderLevel + 1]
			const filteredHeaders = headers.filter(h => allowedLevels.includes(h.level))

			if (filteredHeaders.length === 0) {
				return [rootNode]
			}

			logDebug(`Splitting into ${filteredHeaders.length} nodes based on headers`)

			// Extract content sections
			const sections: Array<{
				header: typeof filteredHeaders[0]
				content: string
				isTopLevel: boolean
			}> = []

			for (let i = 0; i < filteredHeaders.length; i++) {
				const header = filteredHeaders[i]
				const nextHeader = filteredHeaders[i + 1]

				const startIndex = header.startIndex
				const endIndex = nextHeader ? nextHeader.startIndex : fullText.length
				const content = fullText.slice(startIndex, endIndex).trim()

				sections.push({
					header,
					content,
					isTopLevel: header.level === firstHeaderLevel
				})
			}

			// Create nodes for each section
			const createdNodes: CanvasNode[] = []
			const topLevelNodes: CanvasNode[] = []

			// Handle root content (content before first header)
			const firstHeaderIndex = filteredHeaders[0].startIndex
			const rootContent = fullText.slice(0, firstHeaderIndex).trim()

			if (rootContent) {
				// Update the original root node with pre-header content
				rootNode.setText(rootContent)
				rootNode.moveAndResize({
					x: rootNode.x,
					y: rootNode.y,
					width: 400,
					height: calcHeight({ text: rootContent, parentHeight: node.height })
				})
				createdNodes.push(rootNode)
			} else {
				// Remove the placeholder if no root content
				canvas.removeNode(rootNode)
			}

			// Create nodes for each header section
			for (const section of sections) {
				const color = section.header.level === firstHeaderLevel ? '1' : '4' // Red for H1, Green for H2

				const newNode = createNode(
					canvas,
					node,
					{
						text: section.content,
						size: {
							height: calcHeight({
								text: section.content,
								parentHeight: node.height
							})
						}
					},
					{
						color: color,
						chat_role: 'assistant'
					}
				)

				createdNodes.push(newNode)

				if (section.isTopLevel) {
					topLevelNodes.push(newNode)
				}
			}

			return { allNodes: createdNodes, topLevelNodes, rootNode: rootContent ? rootNode : null }
		}

		// Radial layout helpers ------------------------------------------------
		const margin = 40

		const getAngleSequence = (n: number): number[] => {
			if (n === 1) return [0]

			// Mirror-balanced ordering (0°, 180°, 60°, 240°, 120° …)
			const increment = (2 * Math.PI) / n
			const baseAngles = Array.from({ length: n }, (_v, i) => i * increment)
			const ordered: number[] = []
			while (baseAngles.length) {
				ordered.push(baseAngles.shift()!)
				if (baseAngles.length) ordered.push(baseAngles.pop()!)
			}

			return ordered
		}

		const getEdgeSides = (from: CanvasNode, to: CanvasNode) => {
			// Get all existing edges to check for crossings
			const getExistingEdges = (): Array<{ from: { x: number, y: number }, to: { x: number, y: number } }> => {
				try {
					const canvasData = (canvas as any).getData?.()
					if (!canvasData?.edges) return []

					const edges: Array<{ from: { x: number, y: number }, to: { x: number, y: number } }> = []

					for (const edge of canvasData.edges) {
						const fromNode = canvasData.nodes?.find((n: any) => n.id === edge.fromNode)
						const toNode = canvasData.nodes?.find((n: any) => n.id === edge.toNode)

						if (fromNode && toNode) {
							// Calculate actual connection points based on edge sides
							const fromPoint = getActualConnectionPoint(fromNode, edge.fromSide || 'right')
							const toPoint = getActualConnectionPoint(toNode, edge.toSide || 'left')

							edges.push({ from: fromPoint, to: toPoint })
						}
					}

					return edges
				} catch (error) {
					logDebug('Failed to get existing edges:', error)
					return []
				}
			}

			// Get the actual connection point for a node and side
			const getActualConnectionPoint = (nodeData: any, side: string): { x: number, y: number } => {
				const centerX = nodeData.x + nodeData.width / 2
				const centerY = nodeData.y + nodeData.height / 2

				switch (side) {
					case 'top': return { x: centerX, y: nodeData.y }
					case 'bottom': return { x: centerX, y: nodeData.y + nodeData.height }
					case 'left': return { x: nodeData.x, y: centerY }
					case 'right': return { x: nodeData.x + nodeData.width, y: centerY }
					default: return { x: centerX, y: centerY }
				}
			}

			const existingEdges = getExistingEdges()

			// Calculate connection points for all four sides of each node
			const getConnectionPoints = (node: CanvasNode) => {
				const centerX = node.x + node.width / 2
				const centerY = node.y + node.height / 2

				return {
					top: { x: centerX, y: node.y },
					bottom: { x: centerX, y: node.y + node.height },
					left: { x: node.x, y: centerY },
					right: { x: node.x + node.width, y: centerY }
				}
			}

			// Check if two line segments intersect
			const linesIntersect = (p1: { x: number, y: number }, p2: { x: number, y: number },
				p3: { x: number, y: number }, p4: { x: number, y: number }): boolean => {
				const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y)
				if (denominator === 0) return false // parallel lines

				const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator
				const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator

				return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1
			}

			// Check if a potential edge would cross any existing edges
			const wouldCross = (fromPoint: { x: number, y: number }, toPoint: { x: number, y: number }): boolean => {
				for (const edge of existingEdges) {
					if (linesIntersect(fromPoint, toPoint, edge.from, edge.to)) {
						return true
					}
				}
				return false
			}

			// Calculate path cost considering distance and crossings
			const calculatePathCost = (fromPoint: { x: number, y: number }, toPoint: { x: number, y: number }): number => {
				const distance = Math.sqrt(
					Math.pow(toPoint.x - fromPoint.x, 2) +
					Math.pow(toPoint.y - fromPoint.y, 2)
				)

				// Heavy penalty for crossing existing edges
				const crossingPenalty = wouldCross(fromPoint, toPoint) ? distance * 10 : 0

				return distance + crossingPenalty
			}

			const fromPoints = getConnectionPoints(from)
			const toPoints = getConnectionPoints(to)

			// Find the best connection that minimizes crossings and distance
			let minCost = Infinity
			let bestConnection = { fromSide: 'right', toSide: 'left' }

			const sides = ['top', 'bottom', 'left', 'right'] as const

			for (const fromSide of sides) {
				for (const toSide of sides) {
					const fromPoint = fromPoints[fromSide]
					const toPoint = toPoints[toSide]

					const cost = calculatePathCost(fromPoint, toPoint)

					if (cost < minCost) {
						minCost = cost
						bestConnection = { fromSide, toSide }
					}
				}
			}

			return bestConnection
		}



		// Helper to extract first H1 or H2 title from markdown
		const extractTitle = (markdown: string): string => {
			const lines = markdown.split('\n')
			for (const line of lines) {
				const h1 = line.match(/^#\s+(.+)/)
				if (h1) return h1[1].trim()
				const h2 = line.match(/^##\s+(.+)/)
				if (h2) return h2[1].trim()
			}
			return 'AI Mind-map'
		}

		// Calculate bounding box of all nodes generated by streaming
		const adjustGroupBoundsAndTitle = (fullText: string) => {
			const tree = streamingHandler.getTreeStructure()
			if (!tree) return
			const nodes: CanvasNode[] = []
			const collect = (tn: any) => {
				if (tn.canvasNode) nodes.push(tn.canvasNode)
				tn.children?.forEach((c: any) => collect(c))
			}
			collect(tree)

			if (!nodes.length) return

			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
			nodes.forEach(n => {
				minX = Math.min(minX, n.x)
				minY = Math.min(minY, n.y)
				maxX = Math.max(maxX, n.x + n.width)
				maxY = Math.max(maxY, n.y + n.height)
			})

			const margin = 80
			if (groupId) {
				updateGroup(canvas, groupId, {
					x: minX - margin,
					y: minY - margin,
					width: maxX - minX + margin * 2,
					height: maxY - minY + margin * 2,
					label: extractTitle(fullText)
				})
			}
		}

		// Override completion to split into mindmap and apply layout
		const originalOnComplete = streamingHandler.onComplete
		streamingHandler.onComplete = async (fullText: string) => {
			originalOnComplete(fullText)

			try {
				// Split the single note into mindmap structure
				const result = await splitIntoMindmap(fullText, placeholder)

				if (Array.isArray(result)) {
					// No headers found, keep single note
					adjustGroupBoundsAndTitle(fullText)
				} else {
					// Apply radial layout to the created nodes
					const { topLevelNodes, rootNode } = result

					if (topLevelNodes.length > 0) {
						// Create a center point for the layout
						const centerNode = rootNode || topLevelNodes[0]

						// Apply radial layout around center
						const applyRadialLayoutToNodes = (center: CanvasNode, nodes: CanvasNode[]) => {
							if (nodes.length === 0) return

							const n = nodes.length
							const angles = getAngleSequence(n)

							// Calculate radius based on node sizes
							const maxWidth = Math.max(...nodes.map(node => node.width))
							const maxHeight = Math.max(...nodes.map(node => node.height))
							const nodeHalfDiag = Math.sqrt(Math.pow(maxWidth / 2, 2) + Math.pow(maxHeight / 2, 2))
							const centerHalfDiag = Math.sqrt(Math.pow(center.width / 2, 2) + Math.pow(center.height / 2, 2))

							const childCircleRadius = n === 1 ? 0 : (nodeHalfDiag * 2 + margin) / (2 * Math.sin(Math.PI / n))
							const parentClearRadius = centerHalfDiag + nodeHalfDiag + margin
							let radius = Math.max(childCircleRadius, parentClearRadius, 300) // minimum 300px radius

							if (n > 5) {
								radius *= 1.2
							}

							nodes.forEach((nodeToPosition, idx) => {
								if (nodeToPosition === center) return // Don't move the center node

								const angle = angles[idx % angles.length]
								let newX = center.x + radius * Math.cos(angle)
								let newY = center.y + radius * Math.sin(angle)

								newX = Math.max(50, newX)
								newY = Math.max(0, newY)

								nodeToPosition.moveAndResize({
									x: newX,
									y: newY,
									width: nodeToPosition.width,
									height: nodeToPosition.height
								})

								// Create edge from center to this node
								try {
									const sides = getEdgeSides(center, nodeToPosition)
										; (canvas as any).createEdge?.(center, nodeToPosition, sides)
								} catch (edgeErr) {
									logDebug('Edge creation failed', edgeErr)
								}
							})
						}

						// Apply layout to top-level nodes around center
						const nodesToLayout = topLevelNodes.filter(n => n !== centerNode)
						applyRadialLayoutToNodes(centerNode, nodesToLayout)
					}

					// Adjust group bounds to include all nodes
					adjustGroupBoundsAndTitle(fullText)
				}
			} catch (error) {
				logDebug('Error in post-processing split:', error)
				adjustGroupBoundsAndTitle(fullText)
			}

			canvas.requestSave()
		}

		new Notice(`Streaming ${settings.apiModel} response...`)

		await callAIStreaming(
			messages,
			streamingHandler.onToken,
			streamingHandler.onComplete,
			streamingHandler.onError
		)

		await canvas.requestSave()
		return
	}

	/**
	 * Debug function to get the current tree structure visualization
	 */
	const getLastTreeVisualization = (): string => {
		if (!lastStreamingHandler) {
			return 'No streaming session found. Run an AI generation with header-based splitting enabled first.'
		}
		return lastStreamingHandler.getTreeVisualization()
	}

	/**
	 * Debug function to get the raw tree structure
	 */
	const getLastTreeStructure = (): TreeNode | null => {
		if (!lastStreamingHandler) {
			return null
		}
		return lastStreamingHandler.getTreeStructure()
	}

	// ---------------------------------------------------------------------------
	// Encoding & token limit helpers (re-added after earlier refactor)
	// ---------------------------------------------------------------------------

	function getEncoding(settings: InfoverseAICanvasSettings) {
		const openaiModel: ChatModelSettings | undefined = chatModelByName(settings.apiModel)
		if (openaiModel) {
			return encodingForModel(
				(openaiModel.encodingFrom || openaiModel.name || DEFAULT_SETTINGS.apiModel) as TiktokenModel
			)
		}

		// Gemini models – fallback encoding (approximation)
		return encodingForModel('gpt-3.5-turbo' as TiktokenModel)
	}

	function getTokenLimit(settings: InfoverseAICanvasSettings) {
		const openaiModel = chatModelByName(settings.apiModel)
		if (openaiModel) {
			return settings.maxInputTokens
				? Math.min(settings.maxInputTokens, openaiModel.tokenLimit)
				: openaiModel.tokenLimit
		}

		const geminiModel = Object.values(GEMINI_MODELS).find(m => m.name === settings.apiModel)
		if (geminiModel) {
			return settings.maxInputTokens
				? Math.min(settings.maxInputTokens, geminiModel.tokenLimit)
				: geminiModel.tokenLimit
		}

		return settings.maxInputTokens
			? Math.min(settings.maxInputTokens, CHAT_MODELS.GPT_35_TURBO_0125.tokenLimit)
			: CHAT_MODELS.GPT_35_TURBO_0125.tokenLimit
	}

	return {
		nextNote,
		generateNote,
		generateMindmap,
		// Debug utilities
		getLastTreeVisualization,
		getLastTreeStructure
	}
}

/* eslint-disable @typescript-eslint/no-non-null-assertion */
