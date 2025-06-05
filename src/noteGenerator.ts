import { TiktokenModel, encodingForModel } from 'js-tiktoken'
import { App, ItemView, Notice } from 'obsidian'
import { CanvasNode } from './obsidian/canvas-internal'
import { CanvasView, calcHeight, createNode } from './obsidian/canvas-patches'
import {
	CHAT_MODELS,
	chatModelByName,
	ChatModelSettings,
	getChatGPTCompletion,
	getChatGPTStreamingCompletion
} from './openai/chatGPT'
import {
	GEMINI_MODELS,
	getGeminiCompletion,
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
import {
	splitMarkdownForCanvas,
	MarkdownSplitterConfig,
	NodeEdge
} from './util/markdownSplitter'

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
		this.enableLiveSplitting = settings.enableMarkdownSplitting && settings.enableStreamingSplit

		// Debug log the initialization
		this.logDebug(`StreamingHandler initialized:`, {
			enableMarkdownSplitting: settings.enableMarkdownSplitting,
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
		try {
			// Find the content for the previous section (before this header)
			const contentBeforeHeader = this.currentText.slice(this.lastProcessedLength, header.startIndex).trim()

			// If there's content before this header, update the current active node
			if (contentBeforeHeader.length > 0) {
				this.updateCurrentActiveNode()
			}

			// Create a new tree node for this header section
			const newTreeNode: TreeNode = {
				id: `node-${this.nodeCounter++}`,
				content: '', // Will be filled as we stream more content
				headerLevel: header.level,
				headerText: header.text,
				startIndex: header.startIndex,
				endIndex: header.endIndex, // Will be updated as content grows
				children: []
			}

			// Find the appropriate parent in the tree hierarchy
			const parentTreeNode = this.findParentForLevel(header.level)
			if (parentTreeNode) {
				newTreeNode.parentId = parentTreeNode.id
				parentTreeNode.children.push(newTreeNode)
				this.logDebug(`Added node "${header.text}" as child of "${parentTreeNode.headerText}"`)
			} else {
				// This is a root-level header, add to tree root
				if (this.treeRoot) {
					newTreeNode.parentId = this.treeRoot.id
					this.treeRoot.children.push(newTreeNode)
				}
				this.logDebug(`Added node "${header.text}" as root-level header`)
			}

			// Create the canvas node for this tree node
			await this.createCanvasNodeForTreeNode(newTreeNode, parentTreeNode)

			// Store in node map
			this.nodeMap.set(newTreeNode.id, newTreeNode)

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
			if (this.settings.enableMarkdownHierarchy && parentTreeNode?.canvasNode) {
				try {
					(this.canvas as any).createEdge?.(parentTreeNode.canvasNode, canvasNode, {
						fromSide: 'right',
						toSide: 'left'
					})
					this.logDebug('Created edge between nodes')
				} catch (edgeError) {
					this.logDebug('Edge creation not supported, skipping edges:', edgeError)
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
		const horizontalSpacing = this.settings.markdownHierarchySpacing || 450
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

		// Find the most recently created node (highest start index)
		const allNodes = Array.from(this.nodeMap.values())
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
			if (header.startIndex > startIndex && header.level <= treeNode.headerLevel) {
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

		// Try header-based splitting if enabled
		if (this.enableLiveSplitting) {
			await this.tryHeaderBasedSplit()
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

	// Unified API call function that handles both OpenAI and Gemini
	const callAI = async (
		messages: openai.ChatCompletionRequestMessage[]
	): Promise<string | undefined> => {
		const provider = getProviderFromModel(settings.apiModel)
		const apiKey = provider === 'OpenAI' ? settings.openaiApiKey : settings.geminiApiKey

		if (provider === 'Gemini') {
			return await getGeminiCompletion(
				apiKey,
				settings.apiModel,
				messages.map(msg => ({
					role: msg.role,
					content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
				})),
				{
					temperature: settings.temperature,
					maxOutputTokens: settings.maxResponseTokens || undefined
				}
			)
		} else {
			// Default to OpenAI
			return await getChatGPTCompletion(
				apiKey,
				settings.apiUrl,
				settings.apiModel,
				messages,
				{
					max_tokens: settings.maxResponseTokens || undefined,
					temperature: settings.temperature
				}
			)
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

				// Always use streaming
				const streamingHandler = new StreamingHandler(
					canvas,
					node,
					created,
					settings,
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

	const generateMindmapNote = async () => {
		if (!canCallAI()) return

		logDebug('Creating AI note (mindmap mode simplified to single note)')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values())
		const node = values[0]

		if (node) {
			// Last typed characters might not be applied to note yet
			await canvas.requestSave()
			await sleep(200)

			const { messages, tokenCount } = await buildMessages(node)
			if (!messages.length) return

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

				// Use streaming if enabled
				if (settings.enableStreaming) {
					const streamingHandler = new StreamingHandler(
						canvas,
						node,
						created,
						settings,
						logDebug
					)

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

				// Fallback to non-streaming mode
				const generated = await callAI(messages)

				if (generated == null) {
					new Notice(`Empty or unreadable response from AI`)
					canvas.removeNode(created)
					return
				}

				// Single note output (mindmap functionality removed)
				created.setText(generated)
				const height = calcHeight({
					text: generated,
					parentHeight: node.height
				})
				created.moveAndResize({
					height,
					width: created.width,
					x: created.x,
					y: created.y
				})

				canvas.selectOnly(created, false /* startEditing */)
			} catch (error) {
				new Notice(`Error calling AI: ${error.message || error}`)
				canvas.removeNode(created)
			}

			await canvas.requestSave()
		}
	}

	const splitMarkdownHierarchical = async () => {
		if (!settings.enableMarkdownSplitting) {
			new Notice('Markdown splitting is disabled. Enable it in settings.')
			return
		}

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) {
			new Notice('Please select exactly one note containing markdown text')
			return
		}

		const values = Array.from(selection.values())
		const node = values[0]

		if (!node) return

		try {
			// Save any pending changes
			await canvas.requestSave()
			await sleep(200)

			// Get the content of the selected node
			const nodeContent = await readNodeContent(node)
			if (!nodeContent) {
				new Notice('No content found in selected note')
				return
			}

			new Notice('Splitting markdown into hierarchical notes...')

			// Configure the markdown splitter based on settings
			const splitterConfig: MarkdownSplitterConfig = {
				chunkSize: settings.markdownChunkSize,
				chunkOverlap: settings.markdownChunkOverlap,
				keepSeparator: settings.markdownKeepSeparators,
				maxHeaderLevel: 6
			}

			// Split the markdown content
			const { nodes, edges, visualization } = await splitMarkdownForCanvas(
				nodeContent,
				splitterConfig
			)

			logDebug('Split result:', {
				nodeCount: nodes.length,
				edgeCount: edges.length,
				nodes: nodes.map(n => ({ id: n.id, level: n.level, parentId: n.parentId, headerText: n.content.split('\n')[0] }))
			})

			// Show tree visualization if enabled
			if (settings.showMarkdownTreeVisualization && visualization) {
				const visualizationNode = createNode(
					canvas,
					node,
					{
						text: `# Markdown Structure\n\`\`\`\n${visualization}\n\`\`\``,
						size: { height: Math.max(200, visualization.split('\n').length * 20) }
					},
					{
						color: '3', // Yellow for visualization
						chat_role: 'system'
					}
				)

				// Position the visualization node to the side
				visualizationNode.moveAndResize({
					x: node.x + node.width + 50,
					y: node.y,
					width: 400,
					height: visualizationNode.height
				})
			}

			// Create canvas nodes with proper hierarchical relationships
			const createdNodes = new Map<string, CanvasNode>()
			const baseX = node.x
			const baseY = node.y + node.height + 100

			// Helper function to determine node color based on header level
			const getNodeColor = (level: number): string => {
				switch (level) {
					case 0: return '2' // Orange for introduction/root content
					case 1: return '1' // Red for main headers (H1)
					case 2: return '4' // Green for sub-headers (H2)
					case 3: return '5' // Purple for sub-sub-headers (H3)
					case 4: return '6' // Pink for H4
					case 5: return '3' // Yellow for H5
					case 6: return assistantColor // Default purple for H6
					default: return assistantColor // Default
				}
			}

			// Create nodes in hierarchical order, ensuring parents are created before children
			const levelGroups = new Map<number, typeof nodes>()
			nodes.forEach(nodeData => {
				const level = nodeData.level
				if (!levelGroups.has(level)) {
					levelGroups.set(level, [])
				}
				levelGroups.get(level)!.push(nodeData)
			})

			// Sort levels to process from top (0) to bottom
			const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b)

			// Track position for each hierarchy level
			const depthTracker = new Map<string, number>() // Track hierarchy depth for each node

			// Calculate hierarchy depth for each node
			const calculateDepth = (nodeId: string, edgeList: NodeEdge[]): number => {
				if (depthTracker.has(nodeId)) {
					return depthTracker.get(nodeId)!
				}

				// Find parent edge
				const parentEdge = edgeList.find(edge => edge.to === nodeId)
				if (!parentEdge) {
					// Root node
					depthTracker.set(nodeId, 0)
					return 0
				}

				// Recursive depth calculation
				const parentDepth = calculateDepth(parentEdge.from, edgeList)
				const depth = parentDepth + 1
				depthTracker.set(nodeId, depth)
				return depth
			}

			// Calculate depths for all nodes
			nodes.forEach(nodeData => {
				calculateDepth(nodeData.id, edges)
			})

			// Process nodes level by level
			for (const level of sortedLevels) {
				const nodesAtLevel = levelGroups.get(level)!

				for (const nodeData of nodesAtLevel) {
					// Find parent canvas node if it exists
					let parentCanvasNode: CanvasNode | undefined
					if (nodeData.parentId && createdNodes.has(nodeData.parentId)) {
						parentCanvasNode = createdNodes.get(nodeData.parentId)!
					}

					// Calculate position based on hierarchy structure
					let x: number, y: number
					const hierarchyDepth = depthTracker.get(nodeData.id) || 0

					if (hierarchyDepth === 0 || !parentCanvasNode) {
						// Root level nodes - position them in a single column at base position
						const rootIndex = Array.from(createdNodes.values()).filter(n => {
							// Find the node data for this canvas node
							const nodeEntry = Array.from(createdNodes.entries()).find(([id, canvasNode]) => canvasNode === n)
							return nodeEntry && depthTracker.get(nodeEntry[0]) === 0
						}).length

						x = baseX
						y = baseY + (rootIndex * 200) // Space root nodes vertically
					} else {
						// Child nodes - position relative to parent in tree structure
						const parentPos = { x: parentCanvasNode.x, y: parentCanvasNode.y }
						const parentId = nodeData.parentId!

						// Get all siblings at this level under the same parent
						const siblings = nodes.filter(n => n.parentId === parentId)
						const siblingIndex = siblings.findIndex(n => n.id === nodeData.id)

						// Position children to the right of their parent
						x = parentPos.x + (settings.markdownHierarchySpacing || 450)

						// For the first child, start slightly below the parent
						// For subsequent children, space them vertically
						if (siblingIndex === 0) {
							y = parentPos.y + 50 // First child starts slightly below parent
						} else {
							// Calculate cumulative height of previous siblings to avoid overlap
							let cumulativeHeight = parentPos.y + 50
							for (let i = 0; i < siblingIndex; i++) {
								const siblingId = siblings[i].id
								const siblingNode = createdNodes.get(siblingId)
								if (siblingNode) {
									cumulativeHeight += siblingNode.height + 30 // Add sibling height plus spacing
								} else {
									cumulativeHeight += 150 // Estimated height if sibling not yet created
								}
							}
							y = cumulativeHeight
						}
					}

					// Create the canvas node
					const createdNode = createNode(
						canvas,
						parentCanvasNode || node,
						{
							text: nodeData.content,
							size: {
								height: calcHeight({
									text: nodeData.content,
									parentHeight: (parentCanvasNode || node).height
								})
							}
						},
						{
							color: getNodeColor(nodeData.level),
							chat_role: 'assistant'
						}
					)

					// Position the node
					createdNode.moveAndResize({
						x,
						y,
						width: 400,
						height: createdNode.height
					})

					// Store the created node
					createdNodes.set(nodeData.id, createdNode)

					logDebug(`Created node: ${nodeData.id}, level: ${nodeData.level}, depth: ${hierarchyDepth}, position: (${x}, ${y}), parentId: ${nodeData.parentId}`)
				}
			}

			// Create edges if hierarchy is enabled
			if (settings.enableMarkdownHierarchy) {
				let edgesCreated = 0
				for (const edge of edges) {
					const parentNode = createdNodes.get(edge.from)
					const childNode = createdNodes.get(edge.to)

					if (parentNode && childNode) {
						try {
							// Create edge using canvas internal method
							(canvas as any).createEdge?.(parentNode, childNode, {
								fromSide: 'right',
								toSide: 'left'
							})
							edgesCreated++
							logDebug(`Created edge: ${edge.from} -> ${edge.to}`)
						} catch (edgeError) {
							// Fallback: create visual indicators if edge creation fails
							logDebug('Edge creation not supported:', edgeError)
						}
					} else {
						logDebug(`Missing nodes for edge ${edge.from} -> ${edge.to}:`, {
							parentExists: !!parentNode,
							childExists: !!childNode
						})
					}
				}

				if (edgesCreated > 0) {
					new Notice(`Created ${nodes.length} hierarchical notes with ${edgesCreated} connections`)
				} else {
					new Notice(`Created ${nodes.length} hierarchical notes (edge creation not supported by this canvas version)`)
				}
			} else {
				new Notice(`Created ${nodes.length} hierarchical notes`)
			}

			await canvas.requestSave()
		} catch (error) {
			console.error('Error splitting markdown:', error)
			new Notice(`Error splitting markdown: ${error.message || error}`)
		}
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

	/**
	 * Generate hierarchical mindmap from selected note
	 */
	const generateHierarchicalMindmap = async () => {
		if (!canCallAI()) return

		logDebug('Creating hierarchical mindmap')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values())
		const node = values[0]

		if (node) {
			await canvas.requestSave()
			await sleep(200)

			const { messages, tokenCount } = await buildMessages(node)
			if (!messages.length) return

			// Add specific prompt for hierarchical mindmap
			const mindmapPrompt = `Create a hierarchical mindmap from the content. Structure your response with clear headers and subheaders using markdown format. Start with a main topic, then break it down into key categories with subcategories. Use ## for main categories, ### for subcategories, and #### for details. Make it comprehensive and well-organized.`

			messages.push({
				role: 'user',
				content: mindmapPrompt
			})

			const created = createNode(
				canvas,
				node,
				{
					text: `Creating hierarchical mindmap (${settings.apiModel})...`,
					size: { height: placeholderNoteHeight }
				},
				{
					color: '4', // Green for hierarchical
					chat_role: 'assistant'
				}
			)

			new Notice(`Generating hierarchical mindmap with ${tokenCount} tokens`)

			try {
				// Always use streaming with header-based splitting enabled temporarily
				const originalSplittingEnabled = settings.enableMarkdownSplitting
				settings.enableMarkdownSplitting = true

				const streamingHandler = new StreamingHandler(
					canvas,
					node,
					created,
					settings,
					logDebug
				)

				lastStreamingHandler = streamingHandler

				await callAIStreaming(
					messages,
					streamingHandler.onToken,
					streamingHandler.onComplete,
					streamingHandler.onError
				)

				// Restore original setting
				settings.enableMarkdownSplitting = originalSplittingEnabled

				await canvas.requestSave()
			} catch (error) {
				new Notice(`Error generating hierarchical mindmap: ${error.message || error}`)
				canvas.removeNode(created)
			}
		}
	}

	/**
	 * Generate radial mindmap from selected note
	 */
	const generateRadialMindmap = async () => {
		if (!canCallAI()) return

		logDebug('Creating radial mindmap')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values())
		const node = values[0]

		if (node) {
			await canvas.requestSave()
			await sleep(200)

			const { messages, tokenCount } = await buildMessages(node)
			if (!messages.length) return

			// Add specific prompt for radial mindmap
			const mindmapPrompt = `Create a radial mindmap structure from the content. Generate multiple related branches that extend from the central concept. Structure it as separate key topics that each explore different aspects of the main idea. Each topic should be distinct but connected to the central theme. Use ## headers for each main branch.`

			messages.push({
				role: 'user',
				content: mindmapPrompt
			})

			const created = createNode(
				canvas,
				node,
				{
					text: `Creating radial mindmap (${settings.apiModel})...`,
					size: { height: placeholderNoteHeight }
				},
				{
					color: '5', // Blue for radial
					chat_role: 'assistant'
				}
			)

			new Notice(`Generating radial mindmap with ${tokenCount} tokens`)

			try {
				const generated = await callAI(messages)

				if (generated == null) {
					new Notice(`Empty response from AI`)
					canvas.removeNode(created)
					return
				}

				// Parse the response into topics and create nodes in radial pattern
				const topics = generated.split(/(?=^## )/gm).filter(section => section.trim())

				if (topics.length <= 1) {
					// If no clear sections, create as single node
					created.setText(generated)
					const height = calcHeight({
						text: generated,
						parentHeight: node.height
					})
					created.moveAndResize({
						height,
						width: created.width,
						x: created.x,
						y: created.y
					})
				} else {
					// Create radial layout
					canvas.removeNode(created) // Remove placeholder

					const centerX = node.x + node.width + 300
					const centerY = node.y + node.height / 2
					const radius = 250
					const angleStep = (2 * Math.PI) / topics.length

					topics.forEach((topic, index) => {
						const angle = index * angleStep
						const x = centerX + Math.cos(angle) * radius
						const y = centerY + Math.sin(angle) * radius

						const topicNode = createNode(
							canvas,
							node,
							{
								text: topic.trim(),
								size: {
									height: calcHeight({
										text: topic.trim(),
										parentHeight: node.height
									})
								}
							},
							{
								color: '5', // Blue for radial
								chat_role: 'assistant'
							}
						)

						topicNode.moveAndResize({
							x: x - 200, // Offset for node width
							y: y - topicNode.height / 2,
							width: 400,
							height: topicNode.height
						})
					})

					new Notice(`Created radial mindmap with ${topics.length} branches`)
				}

				await canvas.requestSave()
			} catch (error) {
				new Notice(`Error generating radial mindmap: ${error.message || error}`)
				canvas.removeNode(created)
			}
		}
	}

	/**
	 * Generate single AI response note without chunking or splitting
	 */
	const generateSingleAIResponse = async () => {
		if (!canCallAI()) return

		logDebug('Creating single AI response note')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return
		const values = Array.from(selection.values())
		const node = values[0]

		if (node) {
			await canvas.requestSave()
			await sleep(200)

			const { messages, tokenCount } = await buildMessages(node)
			if (!messages.length) return

			const created = createNode(
				canvas,
				node,
				{
					text: `Generating AI response (${settings.apiModel})...`,
					size: { height: placeholderNoteHeight }
				},
				{
					color: assistantColor,
					chat_role: 'assistant'
				}
			)

			new Notice(`Generating single AI response with ${tokenCount} tokens`)

			try {
				// Force single note mode by temporarily disabling splitting
				const originalSplittingEnabled = settings.enableMarkdownSplitting
				const originalStreamingEnabled = settings.enableStreaming

				settings.enableMarkdownSplitting = false

				if (originalStreamingEnabled) {
					// Use streaming but without splitting
					const streamingHandler = new StreamingHandler(
						canvas,
						node,
						created,
						settings,
						logDebug
					)

					await callAIStreaming(
						messages,
						streamingHandler.onToken,
						streamingHandler.onComplete,
						streamingHandler.onError
					)
				} else {
					// Use non-streaming mode
					const generated = await callAI(messages)

					if (generated == null) {
						new Notice(`Empty response from AI`)
						canvas.removeNode(created)
						return
					}

					created.setText(generated)
					const height = calcHeight({
						text: generated,
						parentHeight: node.height
					})
					created.moveAndResize({
						height,
						width: created.width,
						x: created.x,
						y: created.y
					})

					canvas.selectOnly(created, false)
				}

				// Restore original settings
				settings.enableMarkdownSplitting = originalSplittingEnabled
				settings.enableStreaming = originalStreamingEnabled

				await canvas.requestSave()
			} catch (error) {
				new Notice(`Error generating AI response: ${error.message || error}`)
				canvas.removeNode(created)
			}
		}
	}

	return {
		nextNote,
		generateNote,
		generateMindmapNote,
		splitMarkdownHierarchical,
		generateHierarchicalMindmap,
		generateRadialMindmap,
		generateSingleAIResponse,
		// Debug utilities
		getLastTreeVisualization,
		getLastTreeStructure
	}
}

function getEncoding(settings: InfoverseAICanvasSettings) {
	const openaiModel: ChatModelSettings | undefined = chatModelByName(settings.apiModel)
	if (openaiModel) {
		return encodingForModel(
			(openaiModel.encodingFrom || openaiModel.name || DEFAULT_SETTINGS.apiModel) as TiktokenModel
		)
	}

	// For Gemini models, use a fallback encoding (Gemini uses different tokenization)
	// For now, we'll use GPT-3.5-turbo as a reasonable approximation
	return encodingForModel('gpt-3.5-turbo' as TiktokenModel)
}

function getTokenLimit(settings: InfoverseAICanvasSettings) {
	const openaiModel = chatModelByName(settings.apiModel)
	if (openaiModel) {
		return settings.maxInputTokens
			? Math.min(settings.maxInputTokens, openaiModel.tokenLimit)
			: openaiModel.tokenLimit
	}

	// Check if it's a Gemini model
	const geminiModel = Object.values(GEMINI_MODELS).find(model => model.name === settings.apiModel)
	if (geminiModel) {
		return settings.maxInputTokens
			? Math.min(settings.maxInputTokens, geminiModel.tokenLimit)
			: geminiModel.tokenLimit
	}

	// Fallback to default
	return settings.maxInputTokens
		? Math.min(settings.maxInputTokens, CHAT_MODELS.GPT_35_TURBO_0125.tokenLimit)
		: CHAT_MODELS.GPT_35_TURBO_0125.tokenLimit
}
