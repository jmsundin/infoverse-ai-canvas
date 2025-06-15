// Removed dependency on LangChain's RecursiveCharacterTextSplitter in favor of an internal header-aware splitter implementation

/**
 * Represents a markdown node with hierarchical information
 */
export interface MarkdownNode {
	id: string
	content: string
	headerLevel: number
	headerText: string
	parentId?: string
	children: string[]
	startIndex: number
	endIndex: number
}

/**
 * Represents an edge between parent and child nodes
 */
export interface NodeEdge {
	from: string
	to: string
	type: 'parent-child'
}

/**
 * Result of markdown splitting operation
 */
export interface MarkdownSplitResult {
	nodes: MarkdownNode[]
	edges: NodeEdge[]
	rootNodes: string[]
}

/**
 * Configuration for markdown splitting
 */
export interface MarkdownSplitterConfig {
	chunkSize?: number
	chunkOverlap?: number
	keepSeparator?: boolean
	lengthFunction?: (text: string) => number
	maxHeaderLevel?: number // Maximum header level to process (1-6)
}

const DEFAULT_CONFIG: Required<MarkdownSplitterConfig> = {
	chunkSize: 1000,
	chunkOverlap: 200,
	keepSeparator: true,
	lengthFunction: (text: string) => text.length,
	maxHeaderLevel: 6
}

export class MarkdownHeaderTextSplitter {
	private config: Required<MarkdownSplitterConfig>

	constructor(config: MarkdownSplitterConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Fallback chunking when a single header section exceeds the configured chunkSize.
	 * Unlike LangChain's RecursiveCharacterTextSplitter, we keep things simple: we do
	 * fixed-size sliding window chunks with configurable overlap.
	 */
	private simpleSplitText(text: string): string[] {
		const { chunkSize, chunkOverlap, lengthFunction } = this.config

		// Short-circuit for small texts
		if (lengthFunction(text) <= chunkSize) return [text]

		const chunks: string[] = []
		let start = 0

		while (start < text.length) {
			const end = Math.min(text.length, start + chunkSize)
			const chunk = text.slice(start, end)
			chunks.push(chunk)

			if (end >= text.length) break

			// Move the window forward taking overlap into account
			start = end - chunkOverlap
		}

		return chunks
	}

	/**
	 * Split markdown text into hierarchical nodes based on header structure
	 */
	async splitMarkdown(text: string): Promise<MarkdownSplitResult> {
		// First, parse the markdown structure to identify sections
		const headerSections = this.parseMarkdownSections(text)

		// Then use LangChain to intelligently split large sections that exceed chunk size
		const refinedSections = await this.refineSections(headerSections)

		// Create nodes from sections
		const nodes = this.createNodesFromSections(refinedSections)

		// Establish parent-child relationships
		const { updatedNodes, edges } = this.establishRelationships(nodes)

		// Find root nodes (top-level headers or content without headers)
		const rootNodes = updatedNodes
			.filter(node => !node.parentId)
			.map(node => node.id)

		return {
			nodes: updatedNodes,
			edges,
			rootNodes
		}
	}

	/**
	 * Parse markdown text into sections based on headers (similar to original implementation)
	 */
	private parseMarkdownSections(text: string): Array<{
		id: string
		headerLevel: number
		headerText: string
		content: string
		startIndex: number
		endIndex: number
	}> {
		const sections = []
		const lines = text.split('\n')
		let currentIndex = 0
		let sectionIndex = 0

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)

			if (headerMatch) {
				const level = headerMatch[1].length

				// Skip headers beyond max level
				if (level > this.config.maxHeaderLevel) {
					currentIndex += line.length + 1
					continue
				}

				const headerText = headerMatch[2].trim()
				const startIndex = currentIndex

				// Find the end of this section (content until next header at same or higher level)
				let sectionContent = line + '\n'

				for (let j = i + 1; j < lines.length; j++) {
					const nextLine = lines[j]
					const nextHeaderMatch = nextLine.match(/^(#{1,6})\s+(.+)$/)

					if (nextHeaderMatch && nextHeaderMatch[1].length <= level) {
						// Found a header at same or higher level, stop here
						break
					}

					// Check if this is a sub-header that should be its own section
					if (nextHeaderMatch && nextHeaderMatch[1].length > level && nextHeaderMatch[1].length <= this.config.maxHeaderLevel) {
						// This is a sub-header, don't include it in parent content
						break
					}

					// Add this line to current section if it's not a processable header
					if (!nextHeaderMatch || nextHeaderMatch[1].length > this.config.maxHeaderLevel) {
						sectionContent += nextLine + '\n'
					}
				}

				const endIndex = startIndex + sectionContent.length

				sections.push({
					id: `section-${sectionIndex++}`,
					headerLevel: level,
					headerText,
					content: sectionContent.trim(),
					startIndex,
					endIndex
				})
			} else if (i === 0 || sections.length === 0) {
				// Handle content at the beginning without headers
				const contentLines = []
				let j = i

				// Collect lines until we hit a header
				while (j < lines.length) {
					const currentLine = lines[j]
					const headerMatch = currentLine.match(/^(#{1,6})\s+(.+)$/)

					if (headerMatch && headerMatch[1].length <= this.config.maxHeaderLevel) {
						break
					}

					contentLines.push(currentLine)
					j++
				}

				if (contentLines.length > 0 && contentLines.some(line => line.trim() !== '')) {
					const content = contentLines.join('\n').trim()
					sections.push({
						id: `section-${sectionIndex++}`,
						headerLevel: 0,
						headerText: 'Introduction',
						content,
						startIndex: currentIndex,
						endIndex: currentIndex + content.length
					})
				}

				i = j - 1 // Adjust i to continue from the right position
			}

			currentIndex += line.length + 1 // +1 for newline
		}

		return sections
	}

	/**
	 * Use LangChain to further split sections that are too large
	 */
	private async refineSections(sections: Array<{
		id: string
		headerLevel: number
		headerText: string
		content: string
		startIndex: number
		endIndex: number
	}>): Promise<Array<{
		id: string
		headerLevel: number
		headerText: string
		content: string
		startIndex: number
		endIndex: number
	}>> {
		const refinedSections = []

		for (const section of sections) {
			// If section is within chunk size, keep as is
			if (this.config.lengthFunction(section.content) <= this.config.chunkSize) {
				refinedSections.push(section)
				continue
			}

			// Split the oversized section using the internal simple chunker
			const chunks = this.simpleSplitText(section.content)

			// Create sub-sections from chunks
			let chunkStartIndex = section.startIndex
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i]
				const chunkEndIndex = chunkStartIndex + chunk.length

				// Preserve header for first chunk
				if (i === 0) {
					refinedSections.push({
						id: section.id,
						headerLevel: section.headerLevel,
						headerText: section.headerText,
						content: chunk.trim(),
						startIndex: chunkStartIndex,
						endIndex: chunkEndIndex
					})
				} else {
					// Continuation chunks
					const chunkHeaderText = `${section.headerText} (continued ${i + 1})`
					refinedSections.push({
						id: `${section.id}-part-${i + 1}`,
						headerLevel: section.headerLevel,
						headerText: chunkHeaderText,
						content: chunk.trim(),
						startIndex: chunkStartIndex,
						endIndex: chunkEndIndex
					})
				}

				chunkStartIndex = chunkEndIndex
			}
		}

		return refinedSections
	}

	/**
	 * Create nodes from parsed sections
	 */
	private createNodesFromSections(sections: Array<{
		id: string
		headerLevel: number
		headerText: string
		content: string
		startIndex: number
		endIndex: number
	}>): MarkdownNode[] {
		return sections.map(section => ({
			id: section.id,
			content: section.content,
			headerLevel: section.headerLevel,
			headerText: section.headerText,
			children: [],
			startIndex: section.startIndex,
			endIndex: section.endIndex
		}))
	}

	/**
	 * Establish parent-child relationships between nodes based on header hierarchy
	 */
	private establishRelationships(nodes: MarkdownNode[]): {
		updatedNodes: MarkdownNode[]
		edges: NodeEdge[]
	} {
		const edges: NodeEdge[] = []
		const nodeStack: MarkdownNode[] = []

		for (const node of nodes) {
			// Remove nodes from stack that are at same or deeper level
			while (nodeStack.length > 0 && nodeStack[nodeStack.length - 1].headerLevel >= node.headerLevel && node.headerLevel > 0) {
				nodeStack.pop()
			}

			// Set parent relationship if there's a node in the stack and current node has a header
			if (nodeStack.length > 0 && node.headerLevel > 0) {
				const parent = nodeStack[nodeStack.length - 1]
				node.parentId = parent.id
				parent.children.push(node.id)

				edges.push({
					from: parent.id,
					to: node.id,
					type: 'parent-child'
				})
			}

			// Add current node to stack if it has a header level
			if (node.headerLevel > 0) {
				nodeStack.push(node)
			}
		}

		return { updatedNodes: nodes, edges }
	}

	/**
	 * Get the hierarchical tree structure as a string representation
	 */
	getTreeVisualization(result: MarkdownSplitResult): string {
		const lines: string[] = []

		const renderNode = (nodeId: string, depth = 0) => {
			const node = result.nodes.find(n => n.id === nodeId)
			if (!node) return

			const indent = '  '.repeat(depth)
			const headerPrefix = node.headerLevel > 0 ? '#'.repeat(node.headerLevel) + ' ' : ''
			const icon = node.headerLevel === 0 ? '📄' : node.headerLevel === 1 ? '📚' : node.headerLevel === 2 ? '📖' : '📝'
			lines.push(`${indent}${icon} ${headerPrefix}${node.headerText} (${node.content.length} chars, level ${node.headerLevel})`)

			node.children.forEach(childId => {
				renderNode(childId, depth + 1)
			})
		}

		result.rootNodes.forEach(rootId => {
			renderNode(rootId)
		})

		return lines.join('\n')
	}

	/**
	 * Convert nodes to a flat representation suitable for canvas
	 */
	toCanvasNodes(result: MarkdownSplitResult): Array<{
		id: string
		content: string
		level: number
		parentId?: string
		position?: { x: number; y: number }
	}> {
		const canvasNodes: Array<{
			id: string
			content: string
			level: number
			parentId?: string
			position?: { x: number; y: number }
		}> = []
		let yOffset = 0

		const processNode = (nodeId: string, level = 0) => {
			const node = result.nodes.find(n => n.id === nodeId)
			if (!node) return

			canvasNodes.push({
				id: node.id,
				content: node.content,
				level: node.headerLevel,
				parentId: node.parentId,
				position: {
					x: level * 300, // Horizontal spacing based on hierarchy depth
					y: yOffset * 180 // Vertical spacing
				}
			})

			yOffset++

			// Process children recursively
			node.children.forEach(childId => {
				processNode(childId, level + 1)
			})
		}

		result.rootNodes.forEach(rootId => {
			processNode(rootId, 0)
		})

		return canvasNodes
	}
}

// Legacy alias for backward compatibility – behaves exactly the same as the new MarkdownHeaderTextSplitter
export class HierarchicalMarkdownSplitter extends MarkdownHeaderTextSplitter { }

export class RecursiveMarkdownSplitter extends MarkdownHeaderTextSplitter {
	// This now extends the new LangChain-powered hierarchical splitter for backward compatibility
}

/**
 * Utility function to create a markdown splitter with default settings
 */
export function createMarkdownSplitter(config?: MarkdownSplitterConfig): MarkdownHeaderTextSplitter {
	return new MarkdownHeaderTextSplitter(config)
}

/**
 * Quick utility to split markdown and get canvas-ready nodes
 */
export async function splitMarkdownForCanvas(
	text: string,
	config?: MarkdownSplitterConfig
): Promise<{
	nodes: Array<{ id: string; content: string; level: number; parentId?: string; position?: { x: number; y: number } }>
	edges: NodeEdge[]
	visualization: string
}> {
	const splitter = createMarkdownSplitter(config)
	const result = await splitter.splitMarkdown(text)

	return {
		nodes: splitter.toCanvasNodes(result),
		edges: result.edges,
		visualization: splitter.getTreeVisualization(result)
	}
}
