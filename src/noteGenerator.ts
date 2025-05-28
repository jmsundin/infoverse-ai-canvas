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
	ChatStreamSettings,
	DEFAULT_SETTINGS
} from './settings/ChatStreamSettings'
import { Logger } from './util/logging'
import { visitNodeAndAncestors } from './obsidian/canvasUtil'
import { readNodeContent } from './obsidian/fileUtil'
// D3 force simulation imports
import { forceSimulation, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import type { SimulationNodeDatum } from 'd3-force'

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
 * Split text into logical sections for mindmap creation with improved formatting and content awareness
 */
const splitIntoSections = (text: string, maxSections = 0): string[] => {
	if (!text || text.trim().length === 0) return []

	const cleanText = text.trim()

	// First pass: Split by strong structural markers
	const structuralSections = splitByStructuralMarkers(cleanText)

	// Second pass: Process each structural section for optimal chunking
	const processedSections: string[] = []

	for (const section of structuralSections) {
		const chunks = splitSectionIntoChunks(section)
		processedSections.push(...chunks)
	}

	// Third pass: Post-process and enhance sections
	const enhancedSections = enhanceSections(processedSections)

	// Apply maxSections limit if specified
	const finalSections = maxSections > 0 ? enhancedSections.slice(0, maxSections) : enhancedSections

	return finalSections.length > 0 ? finalSections : [cleanText]
}

/**
 * Split text by strong structural markers (headings, code blocks, major sections)
 */
const splitByStructuralMarkers = (text: string): string[] => {
	const sections: string[] = []
	let currentSection = ''

	// Split by lines first
	const lines = text.split('\n')
	let inCodeBlock = false
	let codeBlockContent = ''

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmedLine = line.trim()

		// Handle code blocks specially - keep them together
		if (trimmedLine.startsWith('```')) {
			if (inCodeBlock) {
				// End of code block
				codeBlockContent += line + '\n'
				if (currentSection.trim()) {
					sections.push(currentSection.trim())
					currentSection = ''
				}
				sections.push(codeBlockContent.trim())
				codeBlockContent = ''
				inCodeBlock = false
			} else {
				// Start of code block
				if (currentSection.trim()) {
					sections.push(currentSection.trim())
					currentSection = ''
				}
				codeBlockContent = line + '\n'
				inCodeBlock = true
			}
			continue
		}

		if (inCodeBlock) {
			codeBlockContent += line + '\n'
			continue
		}

		// Check for section breaks
		const isHeading = /^#{1,6}\s/.test(trimmedLine)
		const isNumberedSection = /^\d+\.\s/.test(trimmedLine)
		const isDefinitionSection = /^[A-Z][^.]*:\s*$/.test(trimmedLine)

		// Major section break conditions
		const isMajorBreak = isHeading ||
			(isNumberedSection && currentSection.trim().length > 100) ||
			(isDefinitionSection && currentSection.trim().length > 50)

		if (isMajorBreak && currentSection.trim().length > 0) {
			sections.push(currentSection.trim())
			currentSection = line + '\n'
		} else {
			currentSection += line + '\n'
		}
	}

	// Add remaining content
	if (currentSection.trim().length > 0) {
		sections.push(currentSection.trim())
	}

	// Handle the case where we end with a code block
	if (codeBlockContent.trim().length > 0) {
		sections.push(codeBlockContent.trim())
	}

	return sections.filter(section => section.trim().length > 0)
}

/**
 * Split a section into optimal chunks based on content length and logical breaks
 */
const splitSectionIntoChunks = (section: string): string[] => {
	const contentType = detectContentType(section)
	const maxChunkLength = getOptimalChunkSize(contentType)

	if (section.length <= maxChunkLength) {
		return [section]
	}

	// For longer sections, try to split intelligently
	const chunks: string[] = []

	// Split by paragraphs first
	const paragraphs = section.split(/\n\s*\n/).filter(p => p.trim().length > 0)

	let currentChunk = ''

	for (const paragraph of paragraphs) {
		const trimmedParagraph = paragraph.trim()

		// If adding this paragraph would exceed max length, finalize current chunk
		if (currentChunk.length > 0 && (currentChunk.length + trimmedParagraph.length) > maxChunkLength) {
			chunks.push(currentChunk.trim())
			currentChunk = trimmedParagraph
		} else {
			currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph
		}
	}

	// Add remaining content
	if (currentChunk.trim().length > 0) {
		chunks.push(currentChunk.trim())
	}

	// Handle oversized chunks by splitting on sentences
	const finalChunks: string[] = []
	for (const chunk of chunks) {
		if (chunk.length <= maxChunkLength) {
			finalChunks.push(chunk)
		} else {
			const sentenceChunks = splitBySentences(chunk, maxChunkLength)
			finalChunks.push(...sentenceChunks)
		}
	}

	return finalChunks
}

/**
 * Split text by sentences when other methods don't work
 */
const splitBySentences = (text: string, maxLength: number): string[] => {
	const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
	const chunks: string[] = []
	let currentChunk = ''

	for (const sentence of sentences) {
		const trimmedSentence = sentence.trim()
		if (currentChunk.length > 0 && (currentChunk.length + trimmedSentence.length) > maxLength) {
			chunks.push(currentChunk.trim() + '.')
			currentChunk = trimmedSentence
		} else {
			currentChunk += (currentChunk ? '. ' : '') + trimmedSentence
		}
	}

	if (currentChunk.trim().length > 0) {
		chunks.push(currentChunk.trim() + (currentChunk.endsWith('.') ? '' : '.'))
	}

	return chunks
}

/**
 * Enhance sections with better formatting and headers
 */
const enhanceSections = (sections: string[]): string[] => {
	return sections.map((section, index) => {
		let enhanced = section

		// Don't add headers if the section already has one
		if (!enhanced.match(/^#{1,6}\s/)) {
			// Determine section type and add appropriate header
			if (enhanced.includes('```')) {
				enhanced = `## 💻 Code Block\n\n${enhanced}`
			} else if (enhanced.match(/^\s*\d+\.\s/) || enhanced.includes('Step ') || enhanced.includes('step ')) {
				enhanced = `## 📋 Steps\n\n${enhanced}`
			} else if (enhanced.match(/^\s*[-*+•]\s/) || enhanced.includes('•')) {
				enhanced = `## 📝 Key Points\n\n${enhanced}`
			} else if (enhanced.includes('Example:') || enhanced.includes('example') || enhanced.includes('Example')) {
				enhanced = `## 💡 Example\n\n${enhanced}`
			} else if (enhanced.includes('Note:') || enhanced.includes('Important:') || enhanced.includes('Warning:')) {
				enhanced = `## ⚠️ Important\n\n${enhanced}`
			} else if (enhanced.includes('function') || enhanced.includes('const ') || enhanced.includes('class ') || enhanced.includes('import ')) {
				enhanced = `## ⚙️ Technical\n\n${enhanced}`
			} else if (enhanced.includes('Summary') || enhanced.includes('Conclusion') || enhanced.includes('conclusion')) {
				enhanced = `## 📊 Summary\n\n${enhanced}`
			} else {
				// Generic section header
				enhanced = `## 🔹 Part ${index + 1}\n\n${enhanced}`
			}
		}

		// Improve bullet point formatting
		enhanced = enhanced.replace(/^\s*[-*+]\s/gm, '• ')

		// Clean up excessive whitespace
		enhanced = enhanced.replace(/\n{3,}/g, '\n\n')

		return enhanced.trim()
	})
}

/**
 * Enhanced content type detection with more granular categories
 */
const detectContentType = (text: string): string => {
	const lowerText = text.toLowerCase()

	// Algorithm/method descriptions
	if (lowerText.includes('layout') || lowerText.includes('algorithm') || lowerText.includes('method')) {
		if (lowerText.includes('force') || lowerText.includes('physics')) return 'algorithm-force'
		if (lowerText.includes('hierarchical') || lowerText.includes('tree') || lowerText.includes('layered')) return 'algorithm-hierarchical'
		if (lowerText.includes('radial') || lowerText.includes('circular')) return 'algorithm-radial'
		if (lowerText.includes('organic') || lowerText.includes('natural')) return 'algorithm-organic'
		return 'algorithm'
	}

	// Technical content
	if (text.includes('```')) return 'code'
	if (lowerText.includes('step') && text.match(/\d+\./)) return 'steps'
	if (text.match(/^\s*[-*+•]/m)) return 'list'
	if (lowerText.includes('example')) return 'example'
	if (lowerText.includes('important') || lowerText.includes('note:') || lowerText.includes('warning')) return 'important'
	if (lowerText.includes('summary') || lowerText.includes('conclusion')) return 'summary'
	if (text.match(/^#{1,6}\s/m)) return 'structured'

	return 'general'
}

/**
 * Get optimal chunk size based on content type
 */
const getOptimalChunkSize = (contentType: string): number => {
	switch (contentType) {
		case 'code': return 300 // Shorter for code to keep functions together
		case 'steps': return 200 // Shorter for step-by-step content
		case 'list': return 250 // Medium for lists
		case 'example': return 400 // Longer for examples
		case 'important': return 300 // Medium for important notes
		case 'summary': return 600 // Longer for summaries
		case 'structured': return 500 // Standard for structured content
		default: return 400 // Default size
	}
}

/**
 * Balance section sizes to avoid too many tiny sections or oversized ones
 * Currently unused but kept for potential future use
 */
// const balanceSections = (sections: string[], maxSections = 0): string[] => {
// 	if (sections.length <= 1) return sections

// 	const minSectionLength = 50 // Characters
// 	const idealMinLength = 150 // Preferred minimum

// 	// First pass: merge very small sections with adjacent ones
// 	const mergedSections: string[] = []
// 	let currentMerged = ''

// 	for (let i = 0; i < sections.length; i++) {
// 		const section = sections[i]

// 		if (section.length < minSectionLength) {
// 			// Very small section - merge with previous or next
// 			currentMerged += (currentMerged ? '\n\n' : '') + section
// 		} else if (currentMerged.length > 0 && (currentMerged.length + section.length) < idealMinLength * 2) {
// 			// Continue merging if it makes sense
// 			currentMerged += '\n\n' + section
// 			mergedSections.push(currentMerged)
// 			currentMerged = ''
// 		} else {
// 			// Finalize any merged content first
// 			if (currentMerged.length > 0) {
// 				mergedSections.push(currentMerged)
// 				currentMerged = ''
// 			}
// 			// Add the current section
// 			mergedSections.push(section)
// 		}
// 	}

// 	// Don't forget remaining merged content
// 	if (currentMerged.length > 0) {
// 		mergedSections.push(currentMerged)
// 	}

// 	// Apply maxSections limit if needed
// 	if (maxSections > 0 && mergedSections.length > maxSections) {
// 		// Take the first maxSections, but try to preserve important content
// 		const prioritized = prioritizeSections(mergedSections, maxSections)
// 		return prioritized
// 	}

// 	return mergedSections
// }

/**
 * Prioritize sections when we need to limit count, keeping most important content
 * Currently unused but kept for potential future use
 */
// const prioritizeSections = (sections: string[], maxCount: number): string[] => {
// 	if (sections.length <= maxCount) return sections

// 	// Score sections by importance
// 	const scoredSections = sections.map((section, index) => {
// 		let score = 0

// 		// Prefer sections with headings
// 		if (section.match(/^#{1,6}\s/)) score += 10

// 		// Prefer code blocks
// 		if (section.includes('```')) score += 8

// 		// Prefer sections with examples
// 		if (section.toLowerCase().includes('example')) score += 6

// 		// Prefer sections with important keywords
// 		if (section.toLowerCase().includes('important') || section.toLowerCase().includes('note:')) score += 7

// 		// Prefer longer sections (but not too long)
// 		const lengthScore = Math.min(section.length / 100, 5)
// 		score += lengthScore

// 		// Slight preference for earlier sections
// 		score += Math.max(0, 3 - index * 0.5)

// 		return { section, score, index }
// 	})

// 	// Sort by score and take top sections
// 	const topSections = scoredSections
// 		.sort((a, b) => b.score - a.score)
// 		.slice(0, maxCount)
// 		.sort((a, b) => a.index - b.index) // Restore original order
// 		.map(item => item.section)

// 	return topSections
// }

/**
 * Determine which side of a parent node is closest to a child node position
 * Currently unused but kept for potential future use
 */
// const getClosestSide = (parentNode: CanvasNode, childX: number, childY: number): string => {
// 	const parentCenterX = parentNode.x + parentNode.width / 2
// 	const parentCenterY = parentNode.y + parentNode.height / 2

// 	// Calculate distances to each side
// 	const distanceToTop = Math.abs(childY - parentNode.y)
// 	const distanceToBottom = Math.abs(childY - (parentNode.y + parentNode.height))
// 	const distanceToLeft = Math.abs(childX - parentNode.x)
// 	const distanceToRight = Math.abs(childX - (parentNode.x + parentNode.width))

// 	// Find the minimum distance
// 	const minDistance = Math.min(distanceToTop, distanceToBottom, distanceToLeft, distanceToRight)

// 	if (minDistance === distanceToTop) return 'top'
// 	if (minDistance === distanceToBottom) return 'bottom'
// 	if (minDistance === distanceToLeft) return 'left'
// 	return 'right'
// }

/**
 * Get the opposite side for edge connection
 */
const getOppositeSide = (side: string): string => {
	switch (side) {
		case 'top': return 'bottom'
		case 'bottom': return 'top'
		case 'left': return 'right'
		case 'right': return 'left'
		default: return 'top'
	}
}

/**
 * Enhanced layout algorithms for mindmap positioning
 */
interface NodePosition {
	x: number
	y: number
	bias: string
	level?: number
	importance?: number
}

interface LayoutNode {
	id: number
	text: string
	width: number
	height: number
	contentType: string
	importance: number
	position?: NodePosition
}

/**
 * Collision detection for node overlaps
 */
const detectCollision = (node1: LayoutNode, node2: LayoutNode, padding = 50): boolean => {
	if (!node1.position || !node2.position) return false

	const dx = Math.abs(node1.position.x - node2.position.x)
	const dy = Math.abs(node1.position.y - node2.position.y)

	const requiredDistanceX = (node1.width + node2.width) / 2 + padding
	const requiredDistanceY = (node1.height + node2.height) / 2 + padding

	return dx < requiredDistanceX && dy < requiredDistanceY
}

/**
 * Resolve overlapping nodes using force-based separation
 */
const resolveCollisions = (nodes: LayoutNode[], iterations = 10): void => {
	for (let iter = 0; iter < iterations; iter++) {
		let hasCollisions = false

		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				if (detectCollision(nodes[i], nodes[j])) {
					hasCollisions = true

					// Calculate separation force
					const dx = nodes[j].position!.x - nodes[i].position!.x
					const dy = nodes[j].position!.y - nodes[i].position!.y
					const distance = Math.sqrt(dx * dx + dy * dy)

					if (distance > 0) {
						const minDistance = (nodes[i].width + nodes[j].width) / 2 + 100
						const force = (minDistance - distance) / distance

						const moveX = (dx * force) / 4
						const moveY = (dy * force) / 4

						// Move nodes apart based on their importance (less important nodes move more)
						const totalImportance = nodes[i].importance + nodes[j].importance
						const ratio1 = nodes[j].importance / totalImportance
						const ratio2 = nodes[i].importance / totalImportance

						nodes[i].position!.x -= moveX * ratio1
						nodes[i].position!.y -= moveY * ratio1
						nodes[j].position!.x += moveX * ratio2
						nodes[j].position!.y += moveY * ratio2
					}
				}
			}
		}

		if (!hasCollisions) break
	}
}

/**
 * Hierarchical tree layout for content with clear structure
 */
const createHierarchicalLayout = (
	nodes: LayoutNode[],
	centerX: number,
	centerY: number,
	spacingSettings: any
): NodePosition[] => {
	// Group nodes by content type and importance
	const grouped = new Map<string, LayoutNode[]>()

	nodes.forEach(node => {
		const key = node.contentType === 'structured' ? 'primary' :
			node.contentType === 'important' ? 'secondary' : 'tertiary'
		if (!grouped.has(key)) grouped.set(key, [])
		grouped.get(key)!.push(node)
	})

	const positions: NodePosition[] = []
	const layers = [
		{ key: 'primary', radius: 600 * spacingSettings.multiplier, maxPerLayer: 4 },
		{ key: 'secondary', radius: 900 * spacingSettings.multiplier, maxPerLayer: 6 },
		{ key: 'tertiary', radius: 1200 * spacingSettings.multiplier, maxPerLayer: 8 }
	]

	layers.forEach((layer, layerIndex) => {
		const layerNodes = grouped.get(layer.key) || []
		const angleStep = (2 * Math.PI) / Math.min(layerNodes.length, layer.maxPerLayer)

		layerNodes.forEach((node, index) => {
			const angle = angleStep * index
			const x = centerX + Math.cos(angle) * layer.radius
			const y = centerY + Math.sin(angle) * layer.radius

			node.position = {
				x,
				y,
				bias: angle < Math.PI ? 'top' : 'bottom',
				level: layerIndex,
				importance: node.importance
			}

			positions.push(node.position)
		})
	})

	return positions
}

/**
 * Enhanced organic/natural layout with content-aware grouping
 */
const createOrganicLayout = (
	nodes: LayoutNode[],
	centerX: number,
	centerY: number,
	spacingSettings: any
): NodePosition[] => {
	const positions: NodePosition[] = []

	// Group nodes by content type for better visual organization
	const contentGroups = new Map<string, LayoutNode[]>()
	nodes.forEach(node => {
		const groupKey = node.contentType.startsWith('algorithm-') ? 'algorithms' : node.contentType
		if (!contentGroups.has(groupKey)) contentGroups.set(groupKey, [])
		contentGroups.get(groupKey)!.push(node)
	})

	// Sort groups by importance and size
	const sortedGroups = Array.from(contentGroups.entries()).sort((a, b) => {
		const priorityOrder = ['algorithms', 'summary', 'important', 'code', 'steps', 'list', 'general']
		const priorityA = priorityOrder.indexOf(a[0]) !== -1 ? priorityOrder.indexOf(a[0]) : 999
		const priorityB = priorityOrder.indexOf(b[0]) !== -1 ? priorityOrder.indexOf(b[0]) : 999
		return priorityA - priorityB
	})

	// Create content-aware branches
	const totalGroups = sortedGroups.length
	const angleStep = (2 * Math.PI) / Math.max(totalGroups, 4)

	sortedGroups.forEach(([groupType, groupNodes], groupIndex) => {
		// Sort nodes within group by importance
		const sortedGroupNodes = groupNodes.sort((a, b) => b.importance - a.importance)

		// Calculate group angle with some offset to avoid predictable patterns
		const baseAngle = angleStep * groupIndex
		const angleVariation = Math.sin(groupIndex * 0.7) * 0.3 // Small organic variation
		const groupAngle = baseAngle + angleVariation

		// Direction vectors for this group
		const dirX = Math.cos(groupAngle)
		const dirY = Math.sin(groupAngle)

		// Position nodes within the group
		sortedGroupNodes.forEach((node, nodeIndex) => {
			// Base distance increases with node index but with organic variation
			const baseDistance = 600 + (nodeIndex * 350) * spacingSettings.multiplier
			const organicDistanceVariation = Math.sin(nodeIndex * 1.1 + groupIndex) * 80
			const distance = baseDistance + organicDistanceVariation

			// Perpendicular spread for multiple nodes in same group
			let perpOffset = 0
			if (sortedGroupNodes.length > 1) {
				const maxSpread = Math.min(200, 100 + sortedGroupNodes.length * 30) * spacingSettings.multiplier
				perpOffset = ((nodeIndex - (sortedGroupNodes.length - 1) / 2) * maxSpread) / Math.max(1, sortedGroupNodes.length - 1)

				// Add organic variation to perpendicular offset
				perpOffset += Math.cos(nodeIndex * 1.4 + groupIndex * 0.8) * 50
			}

			// Calculate perpendicular direction (90 degrees to main direction)
			const perpDirX = -dirY
			const perpDirY = dirX

			// Final position with organic curves
			const x = centerX + (dirX * distance) + (perpDirX * perpOffset)
			const y = centerY + (dirY * distance) + (perpDirY * perpOffset)

			// Determine bias based on position relative to center
			let bias = 'center'
			if (Math.abs(dirX) > Math.abs(dirY)) {
				bias = dirX > 0 ? 'right' : 'left'
			} else {
				bias = dirY > 0 ? 'bottom' : 'top'
			}

			node.position = {
				x,
				y,
				bias,
				level: nodeIndex,
				importance: node.importance
			}

			positions.push(node.position)
		})
	})

	return positions
}

/**
 * D3-powered force-directed layout with advanced physics simulation
 */
const createForceDirectedLayout = (
	nodes: LayoutNode[],
	centerX: number,
	centerY: number,
	spacingSettings: any
): NodePosition[] => {
	// Define D3 simulation node interface
	interface D3Node extends SimulationNodeDatum {
		id: number
		width: number
		height: number
		importance: number
		contentType: string
	}

	// Convert layout nodes to D3 nodes
	const d3Nodes: D3Node[] = nodes.map((node, index) => ({
		id: index,
		width: node.width,
		height: node.height,
		importance: node.importance,
		contentType: node.contentType,
		// Initialize with random positions in a circle
		x: centerX + Math.cos((2 * Math.PI * index) / nodes.length) * 200 * spacingSettings.multiplier,
		y: centerY + Math.sin((2 * Math.PI * index) / nodes.length) * 200 * spacingSettings.multiplier
	}))

	// Create D3 force simulation
	const simulation = forceSimulation(d3Nodes)
		// Repulsion between nodes - stronger for larger/more important nodes
		.force('charge', forceManyBody()
			.strength((d: D3Node) => {
				const baseStrength = -800 * spacingSettings.multiplier
				const sizeMultiplier = Math.sqrt(d.width * d.height) / 100
				const importanceMultiplier = d.importance / 3
				return baseStrength * sizeMultiplier * importanceMultiplier
			})
			.distanceMin(50)
			.distanceMax(1000 * spacingSettings.multiplier)
		)
		// Collision detection based on actual node dimensions
		.force('collision', forceCollide()
			.radius((d: D3Node) => {
				// Use the larger dimension plus padding for collision radius
				const radius = Math.max(d.width, d.height) / 2 + 30
				return radius * spacingSettings.multiplier
			})
			.strength(0.8)
			.iterations(3)
		)
		// Gentle centering force - weaker for important nodes
		.force('center', forceCenter(centerX, centerY).strength(0.02))
		// Content-type specific positioning forces
		.force('contentGrouping', () => {
			const alpha = simulation.alpha()
			if (alpha < 0.1) return // Only apply when simulation is settling

			d3Nodes.forEach(node => {
				if (!node.x || !node.y) return

				// Group similar content types together
				const groupAngle = getContentTypeAngle(node.contentType)
				const groupRadius = 400 * spacingSettings.multiplier
				const targetX = centerX + Math.cos(groupAngle) * groupRadius
				const targetY = centerY + Math.sin(groupAngle) * groupRadius

				const dx = targetX - node.x
				const dy = targetY - node.y
				const strength = 0.02 * alpha

				node.x += dx * strength
				node.y += dy * strength
			})
		})
		// Radial force to prevent clustering too close to center
		.force('radial', () => {
			const alpha = simulation.alpha()
			const minRadius = 250 * spacingSettings.multiplier
			d3Nodes.forEach(node => {
				if (!node.x || !node.y) return

				const dx = node.x - centerX
				const dy = node.y - centerY
				const distance = Math.sqrt(dx * dx + dy * dy)

				if (distance < minRadius) {
					const force = (minRadius - distance) / distance * alpha * 0.1
					node.x += dx * force
					node.y += dy * force
				}
			})
		})
		// Stop condition
		.alphaDecay(0.02)
		.alphaMin(0.001)

	// Run simulation synchronously for a fixed number of iterations
	const maxIterations = 300
	let iterations = 0

	while (simulation.alpha() > simulation.alphaMin() && iterations < maxIterations) {
		simulation.tick()
		iterations++

		// Early stopping if nodes have settled
		if (iterations > 50 && simulation.alpha() < 0.01) {
			break
		}
	}

	// Convert D3 nodes back to NodePosition format
	return d3Nodes.map((d3Node, index) => {
		const node = nodes[index]
		const x = d3Node.x || centerX
		const y = d3Node.y || centerY

		// Calculate bias based on final position relative to center
		let bias = 'center'
		const dx = x - centerX
		const dy = y - centerY

		if (Math.abs(dx) > Math.abs(dy)) {
			bias = dx > 0 ? 'right' : 'left'
		} else {
			bias = dy > 0 ? 'bottom' : 'top'
		}

		// Assign position to the original node for collision detection
		node.position = {
			x,
			y,
			bias,
			level: Math.floor(Math.sqrt(dx * dx + dy * dy) / (200 * spacingSettings.multiplier)),
			importance: node.importance
		}

		return node.position
	})
}

/**
 * Get angle for content type grouping in force simulation
 */
const getContentTypeAngle = (contentType: string): number => {
	const typeAngles: { [key: string]: number } = {
		'algorithm': 0,
		'algorithm-force': 0.2,
		'algorithm-hierarchical': 0.4,
		'algorithm-radial': 0.6,
		'algorithm-organic': 0.8,
		'code': Math.PI / 2,
		'steps': Math.PI,
		'list': Math.PI + 0.5,
		'example': 3 * Math.PI / 2,
		'important': 3 * Math.PI / 2 + 0.5,
		'summary': 2 * Math.PI - 0.5,
		'structured': 2 * Math.PI - 1,
		'general': 1.5
	}

	return typeAngles[contentType] || Math.random() * 2 * Math.PI
}

/**
 * Hybrid D3 + Hierarchical layout for optimal results with large mindmaps
 * Combines the natural physics of D3 with the structured organization of hierarchical layouts
 */
const createHybridLayout = (
	nodes: LayoutNode[],
	centerX: number,
	centerY: number,
	spacingSettings: any
): NodePosition[] => {
	if (nodes.length <= 6) {
		// For small graphs, use pure D3 force simulation
		return createForceDirectedLayout(nodes, centerX, centerY, spacingSettings)
	}

	// Group nodes by importance and content type
	const importantNodes = nodes.filter(n => n.importance >= 4)

	// Phase 1: Position important nodes using hierarchical layout
	const importantPositions = createHierarchicalLayout(importantNodes, centerX, centerY, spacingSettings)

	// Update positions on important nodes
	importantNodes.forEach((node, index) => {
		node.position = importantPositions[index]
	})

	// Phase 2: Use D3 force simulation for all nodes, with important nodes fixed
	interface D3Node extends SimulationNodeDatum {
		id: number
		width: number
		height: number
		importance: number
		contentType: string
		isFixed?: boolean
	}

	const d3Nodes: D3Node[] = nodes.map((node, index) => {
		const isImportant = node.importance >= 4
		return {
			id: index,
			width: node.width,
			height: node.height,
			importance: node.importance,
			contentType: node.contentType,
			isFixed: isImportant,
			// Use hierarchical position for important nodes, random for others
			x: node.position?.x || (centerX + Math.cos((2 * Math.PI * index) / nodes.length) * 300 * spacingSettings.multiplier),
			y: node.position?.y || (centerY + Math.sin((2 * Math.PI * index) / nodes.length) * 300 * spacingSettings.multiplier),
			// Fix important nodes at their hierarchical positions
			fx: isImportant ? node.position?.x : null,
			fy: isImportant ? node.position?.y : null
		}
	})

	// Create D3 force simulation with fixed important nodes
	const simulation = forceSimulation(d3Nodes)
		.force('charge', forceManyBody()
			.strength((d: D3Node) => {
				const baseStrength = d.isFixed ? -1200 : -600
				const sizeMultiplier = Math.sqrt(d.width * d.height) / 100
				return baseStrength * spacingSettings.multiplier * sizeMultiplier
			})
		)
		.force('collision', forceCollide()
			.radius((d: D3Node) => {
				const radius = Math.max(d.width, d.height) / 2 + (d.isFixed ? 50 : 30)
				return radius * spacingSettings.multiplier
			})
			.strength(0.9)
		)
		.force('center', forceCenter(centerX, centerY).strength(0.01))
		.alphaDecay(0.03)
		.alphaMin(0.001)

	// Run simulation
	const maxIterations = 200
	let iterations = 0

	while (simulation.alpha() > simulation.alphaMin() && iterations < maxIterations) {
		simulation.tick()
		iterations++

		if (iterations > 30 && simulation.alpha() < 0.01) break
	}

	// Convert back to NodePosition format
	return d3Nodes.map((d3Node, index) => {
		const node = nodes[index]
		const x = d3Node.x || centerX
		const y = d3Node.y || centerY

		let bias = 'center'
		const dx = x - centerX
		const dy = y - centerY

		if (Math.abs(dx) > Math.abs(dy)) {
			bias = dx > 0 ? 'right' : 'left'
		} else {
			bias = dy > 0 ? 'bottom' : 'top'
		}

		node.position = {
			x, y, bias,
			level: d3Node.isFixed ? 0 : 1,
			importance: node.importance
		}

		return node.position
	})
}

/**
 * Enhanced layout calculation with multiple algorithms and collision detection
 */
const calculateOptimalPositions = (
	sections: string[],
	centerX: number,
	centerY: number,
	spacingSettings: any,
	layoutAlgorithm: 'radial' | 'hierarchical' | 'organic' | 'force' | 'hybrid' = 'organic'
): NodePosition[] => {
	if (sections.length === 0) return []

	// Create layout nodes with enhanced metadata
	const layoutNodes: LayoutNode[] = sections.map((text, index) => {
		const contentType = detectContentType(text)
		const importance = calculateImportance(text, contentType)
		const dimensions = calculateNodeDimensions(text, index)

		return {
			id: index,
			text,
			width: dimensions.width,
			height: dimensions.height,
			contentType,
			importance
		}
	})

	// Choose layout algorithm based on content and count
	if (sections.length <= 4) {
		// Simple cross pattern for small counts
		const distance = 700 * spacingSettings.multiplier
		const crossPositions = [
			{ x: centerX, y: centerY - distance, bias: 'top', level: 0, importance: 1 },
			{ x: centerX + distance * 1.2, y: centerY, bias: 'right', level: 0, importance: 1 },
			{ x: centerX, y: centerY + distance, bias: 'bottom', level: 0, importance: 1 },
			{ x: centerX - distance * 1.2, y: centerY, bias: 'left', level: 0, importance: 1 }
		]
		return crossPositions.slice(0, sections.length)
	}

	switch (layoutAlgorithm) {
		case 'hierarchical':
			layoutNodes.forEach((node, index) => {
				node.position = createHierarchicalLayout(layoutNodes, centerX, centerY, spacingSettings)[index]
			})
			break
		case 'force':
			layoutNodes.forEach((node, index) => {
				node.position = createForceDirectedLayout(layoutNodes, centerX, centerY, spacingSettings)[index]
			})
			break
		case 'hybrid':
			layoutNodes.forEach((node, index) => {
				node.position = createHybridLayout(layoutNodes, centerX, centerY, spacingSettings)[index]
			})
			break
		case 'organic':
		default:
			layoutNodes.forEach((node, index) => {
				node.position = createOrganicLayout(layoutNodes, centerX, centerY, spacingSettings)[index]
			})
			break
	}

	// Apply collision detection and resolution only for non-D3 layouts
	if (layoutAlgorithm === 'organic' || layoutAlgorithm === 'hierarchical') {
		resolveCollisions(layoutNodes)
	}

	return layoutNodes.map(node => node.position!)
}

/**
 * Enhanced importance calculation for better positioning
 */
const calculateImportance = (text: string, contentType: string): number => {
	let importance = 1

	// Content type bonuses with algorithm-specific handling
	if (contentType.startsWith('algorithm-')) {
		importance += 3 // Algorithm descriptions are very important

		// Specific algorithm type bonuses
		if (contentType === 'algorithm-force') importance += 0.5 // Physics-based algorithms
		if (contentType === 'algorithm-hierarchical') importance += 0.3 // Structured algorithms
	} else {
		// Regular content type bonuses
		if (contentType === 'code') importance += 2
		if (contentType === 'important') importance += 2
		if (contentType === 'structured') importance += 1
		if (contentType === 'summary') importance += 1.5
		if (contentType === 'steps') importance += 1.2
	}

	// Length bonuses (longer content is often more important)
	if (text.length > 500) importance += 1
	if (text.length > 1000) importance += 1

	// Keyword bonuses with algorithm-specific terms
	const algorithmKeywords = ['layout', 'algorithm', 'method', 'approach', 'technique']
	const generalKeywords = ['important', 'key', 'main', 'primary', 'essential', 'critical']

	const algorithmKeywordCount = algorithmKeywords.filter(keyword =>
		text.toLowerCase().includes(keyword)
	).length

	const generalKeywordCount = generalKeywords.filter(keyword =>
		text.toLowerCase().includes(keyword)
	).length

	importance += algorithmKeywordCount * 0.7 // Higher weight for algorithm terms
	importance += generalKeywordCount * 0.5

	// Headers and structured content bonus
	if (text.match(/^#{1,6}\s/m)) importance += 0.8
	if (text.includes('Steps') || text.includes('Part')) importance += 0.6

	return Math.min(importance, 6) // Cap at 6 for reasonable scaling
}

/**
 * Calculate node dimensions based on content and type
 */
const calculateNodeDimensions = (text: string, index: number) => {
	const contentLength = text.length
	const lineCount = text.split('\n').length
	const contentType = detectContentType(text)

	// Content-type specific sizing
	let baseWidth = 300
	let baseHeight = 100

	switch (contentType) {
		case 'code':
			baseWidth = Math.max(350, Math.min(contentLength * 3.2, 600))
			baseHeight = Math.max(120, lineCount * 35)
			break
		case 'list':
		case 'steps':
			baseWidth = Math.max(280, Math.min(contentLength * 2.5, 500))
			baseHeight = Math.max(100, lineCount * 30)
			break
		case 'important':
			baseWidth = Math.max(320, Math.min(contentLength * 3.0, 550))
			baseHeight = Math.max(110, lineCount * 32)
			break
		default:
			baseWidth = Math.max(280, Math.min(contentLength * 2.8, 520))
			baseHeight = Math.max(
				calcHeight({
					text: text,
					parentHeight: Math.max(200, contentLength / 2.5)
				}),
				80
			)
	}

	// Apply additional adjustments
	const adjustedWidth = baseWidth + (lineCount > 3 ? 40 : 0)
	const adjustedHeight = lineCount > 5 ? baseHeight + 25 : baseHeight

	return { width: adjustedWidth, height: adjustedHeight }
}

/**
 * Analyze canvas context for better layout decisions
 */
const analyzeCanvasContext = (canvas: any, parentNode: CanvasNode) => {
	// Get viewport information
	const viewport = canvas.viewport || { zoom: 1, x: 0, y: 0 }

	// Count existing nodes around the parent - safely handle canvas.nodes
	let allNodes: CanvasNode[] = []

	try {
		// canvas.nodes might be an array, Map, Set, or undefined
		if (canvas.nodes) {
			// Debug: log the type of canvas.nodes to understand its structure
			console.debug('Canvas nodes type:', typeof canvas.nodes, 'isArray:', Array.isArray(canvas.nodes))

			if (Array.isArray(canvas.nodes)) {
				allNodes = canvas.nodes
			} else if (canvas.nodes instanceof Map) {
				allNodes = Array.from(canvas.nodes.values())
			} else if (canvas.nodes instanceof Set) {
				allNodes = Array.from(canvas.nodes)
			} else if (typeof canvas.nodes === 'object') {
				// Try to get values if it's an object with values
				allNodes = Object.values(canvas.nodes).filter((node: any): node is CanvasNode =>
					node && typeof node === 'object' && 'id' in node
				)
			}
		} else {
			console.debug('Canvas nodes is undefined or null')
		}

		// Fallback: try to get nodes from canvas data
		if (allNodes.length === 0) {
			const canvasData = canvas.getData?.()
			if (canvasData?.nodes) {
				console.debug('Trying to get nodes from canvas data, found:', canvasData.nodes.length)
				// Canvas data nodes are typically just data objects, not full CanvasNode instances
				// We'll need to work with what we have
				allNodes = []
			}
		}

		console.debug('Found', allNodes.length, 'nodes for analysis')
	} catch (error) {
		console.warn('Error accessing canvas nodes:', error)
		allNodes = []
	}

	const nearbyNodes = allNodes.filter((node: CanvasNode) => {
		if (!node || !node.id || node.id === parentNode.id) return false

		// Make sure the node has position properties
		if (typeof node.x !== 'number' || typeof node.y !== 'number') return false

		const distance = Math.sqrt(
			Math.pow(node.x - parentNode.x, 2) +
			Math.pow(node.y - parentNode.y, 2)
		)

		return distance < 1500 // Within reasonable proximity
	})

	// Analyze existing layout patterns
	const hasVerticalPattern = nearbyNodes.some((node: CanvasNode) =>
		Math.abs(node.x - parentNode.x) < 100 && Math.abs(node.y - parentNode.y) > 200
	)

	const hasHorizontalPattern = nearbyNodes.some((node: CanvasNode) =>
		Math.abs(node.y - parentNode.y) < 100 && Math.abs(node.x - parentNode.x) > 200
	)

	// Calculate available space
	const availableSpace = {
		top: parentNode.y,
		right: canvas.width ? (canvas.width - parentNode.x - parentNode.width) : 2000,
		bottom: canvas.height ? (canvas.height - parentNode.y - parentNode.height) : 2000,
		left: parentNode.x
	}

	return {
		viewport,
		nearbyNodeCount: nearbyNodes.length,
		hasVerticalPattern,
		hasHorizontalPattern,
		availableSpace,
		canvasSize: { width: canvas.width || 4000, height: canvas.height || 4000 }
	}
}

/**
 * Enhanced layout algorithm selection with context awareness
 */
const getOptimalLayoutAlgorithm = (
	nodeCount: number,
	sections: string[],
	canvasContext?: any
): 'radial' | 'hierarchical' | 'organic' | 'force' | 'hybrid' => {
	// Content analysis
	const hasStructuredContent = sections.some(section =>
		section.includes('##') || section.match(/^\d+\./) || section.includes('Step')
	)

	const hasCodeContent = sections.some(section =>
		section.includes('```') || section.includes('function') || section.includes('class ')
	)

	const contentTypes = new Set(sections.map(detectContentType))
	const hasMixedContent = contentTypes.size > 2
	const hasImportantContent = sections.some(section => calculateImportance(section, detectContentType(section)) >= 4)

	// Calculate content complexity
	const avgLength = sections.reduce((sum, s) => sum + s.length, 0) / sections.length
	const isComplexContent = avgLength > 400

	// Context-based decisions
	if (canvasContext && canvasContext.nearbyNodeCount >= 0) {
		const { nearbyNodeCount, hasVerticalPattern, hasHorizontalPattern, availableSpace } = canvasContext

		// If there are many nearby nodes, use force-directed or hybrid to avoid overlaps
		if (nearbyNodeCount > 5) {
			return nodeCount > 8 && hasImportantContent ? 'hybrid' : 'force'
		}

		// If there's already a clear pattern, adapt to it
		if (hasVerticalPattern && !hasHorizontalPattern) return 'hierarchical'
		if (hasHorizontalPattern && !hasVerticalPattern) return 'hierarchical'

		// If space is constrained, use more compact layouts
		const spaceValues = Object.values(availableSpace) as number[]
		const totalAvailableSpace = spaceValues.reduce((sum, space) => sum + space, 0)
		if (totalAvailableSpace < 3000) return 'hierarchical'
	}

	// Content-based algorithm selection with hybrid for complex large mindmaps
	if (nodeCount <= 4) return 'radial' // Simple cross for small counts

	// Use hybrid for large, complex mindmaps with mixed content
	if (nodeCount > 8 && hasMixedContent && hasImportantContent) {
		return 'hybrid' // Best for large, complex mindmaps
	}

	if (hasStructuredContent && nodeCount <= 8) {
		return 'hierarchical' // Best for structured content
	}

	if (hasCodeContent && nodeCount > 6) {
		return nodeCount > 10 ? 'hybrid' : 'force' // Hybrid for large code-heavy mindmaps
	}

	if (isComplexContent || hasMixedContent) {
		return nodeCount > 10 ? 'force' : 'organic'
	}

	return 'organic' // Default to organic for most natural feel
}

/**
 * Create multiple nodes in a mindmap layout with improved visual organization
 */
const createMindmapNodes = async (
	canvas: any,
	parentNode: CanvasNode,
	sections: string[],
	logDebug: Logger,
	settings: ChatStreamSettings
) => {
	const nodes: CanvasNode[] = []
	const { addEdge } = await import('./obsidian/canvas-patches')
	const { randomHexString } = await import('./utils')

	const centerX = parentNode.x + parentNode.width / 2
	const centerY = parentNode.y + parentNode.height / 2

	// Enhanced visual hierarchy - make parent node more prominent
	const enhanceParentNode = () => {
		parentNode.setData({
			...parentNode.getData(),
			color: '1' // Red color for central importance
		})

		// Optionally resize parent to be more prominent
		const currentWidth = parentNode.width
		const currentHeight = parentNode.height
		const enhancedWidth = Math.max(currentWidth, 400)
		const enhancedHeight = Math.max(currentHeight, 120)

		if (enhancedWidth !== currentWidth || enhancedHeight !== currentHeight) {
			parentNode.moveAndResize({
				x: parentNode.x - (enhancedWidth - currentWidth) / 2,
				y: parentNode.y - (enhancedHeight - currentHeight) / 2,
				width: enhancedWidth,
				height: enhancedHeight
			})
		}
	}

	// Determine content-based colors with better visual distinction
	const getNodeColor = (text: string, index: number) => {
		if (settings.enableMindmapColorCoding) {
			const contentType = detectContentType(text)

			// Enhanced content-based color coding with algorithm differentiation
			switch (contentType) {
				case 'algorithm-force':
					return '5' // Blue for force-directed algorithms
				case 'algorithm-hierarchical':
					return '4' // Green for hierarchical algorithms
				case 'algorithm-radial':
					return '3' // Yellow for radial algorithms
				case 'algorithm-organic':
					return '2' // Orange for organic algorithms
				case 'algorithm':
					return '1' // Red for general algorithms
				case 'code':
					return '4' // Green for code
				case 'steps':
				case 'list':
					return '3' // Yellow for lists/steps
				case 'example':
				case 'important':
					return '2' // Orange for highlights
				case 'summary':
					return '6' // Purple for summaries
				default:
					return '6' // Purple for general content
			}
		}

		// Enhanced color variety when color coding is disabled
		const colorPalette = ['2', '3', '4', '5', '6'] // Skip red (1) as it's for parent
		return colorPalette[index % colorPalette.length]
	}

	// Enhanced spacing configuration with layout-specific settings
	const spacingConfig = {
		compact: { multiplier: 0.8, minRadius: 350, radiusIncrement: 25 },
		normal: { multiplier: 1.2, minRadius: 450, radiusIncrement: 35 },
		spacious: { multiplier: 1.6, minRadius: 600, radiusIncrement: 50 }
	}
	const spacingSettings = spacingConfig[settings.mindmapSpacing] || spacingConfig.normal

	// Enhanced parent node styling
	enhanceParentNode()

	// Analyze canvas context for intelligent layout selection (with error handling)
	let canvasContext
	try {
		canvasContext = analyzeCanvasContext(canvas, parentNode)
		logDebug(`Canvas context analysis: nearby=${canvasContext.nearbyNodeCount}, vertical=${canvasContext.hasVerticalPattern}, horizontal=${canvasContext.hasHorizontalPattern}`)
	} catch (error) {
		logDebug('Canvas context analysis failed, using content-only analysis:', error)
		canvasContext = undefined
	}

	// Calculate positions with intelligent algorithm selection
	const layoutAlgorithm = settings.mindmapLayoutAlgorithm || getOptimalLayoutAlgorithm(sections.length, sections, canvasContext)
	const positions = calculateOptimalPositions(sections, centerX, centerY, spacingSettings, layoutAlgorithm)

	logDebug(`Using ${layoutAlgorithm} layout algorithm for ${sections.length} nodes`)

	// Create nodes with enhanced styling
	for (let i = 0; i < sections.length; i++) {
		const pos = positions[i]
		const { width: nodeWidth, height: nodeHeight } = calculateNodeDimensions(sections[i], i)

		const newNode = canvas.createTextNode({
			pos: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
			position: 'left',
			size: { height: nodeHeight, width: nodeWidth },
			text: sections[i],
			focus: false
		})

		// Enhanced node styling
		newNode.setData({
			color: getNodeColor(sections[i], i),
			chat_role: 'assistant'
		})

		canvas.addNode(newNode)
		nodes.push(newNode)

		// Enhanced edge routing with advanced crossing avoidance
		const edgeRouting = calculateOptimalEdgeRouting(parentNode, newNode, nodes, pos.bias)

		addEdge(
			canvas,
			randomHexString(16),
			{
				fromOrTo: 'from',
				side: edgeRouting.fromSide,
				node: parentNode
			},
			{
				fromOrTo: 'to',
				side: edgeRouting.toSide,
				node: newNode
			}
		)

		logDebug(`Created enhanced mindmap node ${i + 1}/${sections.length} with intelligent routing`)
	}

	// Optional: Add visual flow indicators for complex layouts
	if (sections.length > 6) {
		logDebug('Complex mindmap created with enhanced visual hierarchy')
	}

	return nodes
}

/**
 * Enhanced edge routing with advanced crossing avoidance
 */
const calculateOptimalEdgeRouting = (
	parentNode: CanvasNode,
	childNode: CanvasNode,
	allNodes: CanvasNode[],
	preferredBias: string
) => {
	const parentCenter = {
		x: parentNode.x + parentNode.width / 2,
		y: parentNode.y + parentNode.height / 2
	}

	const childCenter = {
		x: childNode.x + childNode.width / 2,
		y: childNode.y + childNode.height / 2
	}

	// Calculate angle between nodes for intelligent side selection
	const angle = Math.atan2(childCenter.y - parentCenter.y, childCenter.x - parentCenter.x)
	const normalizedAngle = ((angle + 2 * Math.PI) % (2 * Math.PI)) // 0 to 2π

	// Enhanced side selection with bias consideration
	const getSideFromAngle = (angle: number) => {
		if (angle < Math.PI / 4 || angle > 7 * Math.PI / 4) return 'right'
		if (angle < 3 * Math.PI / 4) return 'bottom'
		if (angle < 5 * Math.PI / 4) return 'left'
		return 'top'
	}

	// Primary connection choice based on angle
	let fromSide = getSideFromAngle(normalizedAngle)
	let toSide = getOppositeSide(getSideFromAngle(normalizedAngle)) // Child side facing toward parent

	// Apply bias influence for better visual flow
	if (preferredBias && preferredBias !== 'center') {
		// Bias influences the parent side selection
		switch (preferredBias) {
			case 'top':
				if (fromSide === 'bottom') fromSide = 'top'
				if (fromSide === 'left' || fromSide === 'right') toSide = 'bottom'
				break
			case 'right':
				if (fromSide === 'left') fromSide = 'right'
				if (fromSide === 'top' || fromSide === 'bottom') toSide = 'left'
				break
			case 'bottom':
				if (fromSide === 'top') fromSide = 'bottom'
				if (fromSide === 'left' || fromSide === 'right') toSide = 'top'
				break
			case 'left':
				if (fromSide === 'right') fromSide = 'left'
				if (fromSide === 'top' || fromSide === 'bottom') toSide = 'right'
				break
		}
	}

	// Test for edge crossings and try alternatives if needed
	const connectionOptions = [
		{ from: fromSide, to: toSide, priority: 1 },
		{ from: fromSide, to: getOppositeSide(fromSide), priority: 2 },
		{ from: getOppositeSide(fromSide), to: toSide, priority: 3 },
		{ from: 'top', to: 'bottom', priority: 4 },
		{ from: 'right', to: 'left', priority: 4 },
		{ from: 'bottom', to: 'top', priority: 4 },
		{ from: 'left', to: 'right', priority: 4 }
	]

	// Sort by priority and test each option
	connectionOptions.sort((a, b) => a.priority - b.priority)

	for (const option of connectionOptions) {
		const crossingCount = countEdgeCrossings(parentNode, childNode, allNodes, option.from, option.to)

		// Use the first option with minimal crossings
		if (crossingCount <= 1) { // Allow at most 1 crossing
			return { fromSide: option.from, toSide: option.to }
		}
	}

	// Fallback to the first option if no good solution found
	return { fromSide: connectionOptions[0].from, toSide: connectionOptions[0].to }
}

/**
 * Count potential edge crossings with other edges
 */
const countEdgeCrossings = (
	parentNode: CanvasNode,
	childNode: CanvasNode,
	allNodes: CanvasNode[],
	fromSide: string,
	toSide: string
): number => {
	const fromPoint = getConnectionPoint(parentNode, fromSide)
	const toPoint = getConnectionPoint(childNode, toSide)

	let crossingCount = 0

	// Check against existing edges (approximation)
	for (const node of allNodes) {
		if (node === parentNode || node === childNode) continue

		// Approximate other edges as connections to parent from various sides
		const nodeCenterX = node.x + node.width / 2
		const nodeCenterY = node.y + node.height / 2
		const parentCenterX = parentNode.x + parentNode.width / 2
		const parentCenterY = parentNode.y + parentNode.height / 2

		// Simple line intersection check
		if (lineSegmentsIntersect(
			fromPoint, toPoint,
			{ x: parentCenterX, y: parentCenterY },
			{ x: nodeCenterX, y: nodeCenterY }
		)) {
			crossingCount++
		}
	}

	return crossingCount
}

/**
 * Check if two line segments intersect
 */
const lineSegmentsIntersect = (
	p1: { x: number, y: number }, p2: { x: number, y: number },
	p3: { x: number, y: number }, p4: { x: number, y: number }
): boolean => {
	const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y)

	if (Math.abs(denominator) < 0.001) return false // Lines are parallel

	const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator
	const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator

	return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1
}

/**
 * Get connection point on node based on side
 */
const getConnectionPoint = (node: CanvasNode, side: string) => {
	switch (side) {
		case 'top':
			return { x: node.x + node.width / 2, y: node.y }
		case 'right':
			return { x: node.x + node.width, y: node.y + node.height / 2 }
		case 'bottom':
			return { x: node.x + node.width / 2, y: node.y + node.height }
		case 'left':
			return { x: node.x, y: node.y + node.height / 2 }
		default:
			return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
	}
}

/**
 * StreamingHandler manages real-time text streaming and intelligent chunk splitting
 */
class StreamingHandler {
	private currentText = ''
	private currentNode: CanvasNode | null = null
	private canvas: any
	private parentNode: CanvasNode
	private chunks: string[] = []
	private createdNodes: CanvasNode[] = []
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

	constructor(
		canvas: any,
		parentNode: CanvasNode,
		initialNode: CanvasNode,
		private settings: ChatStreamSettings,
		private logDebug: Logger
	) {
		this.canvas = canvas
		this.parentNode = parentNode
		this.currentNode = initialNode
		this.createdNodes = [initialNode]
		this.startTime = Date.now()

		// Create progress indicator if enabled
		if (this.settings.showStreamingProgress) {
			this.createProgressIndicator()
		}

		// Create streaming control buttons if enabled
		this.createStreamingControls()
	}

	/**
	 * Create a progress indicator node
	 */
	private createProgressIndicator() {
		try {
			this.progressNode = createNode(
				this.canvas,
				this.parentNode,
				{
					text: '📊 Streaming: 0 tokens, 0 chars/sec',
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
		const chunkCount = this.chunks.length + 1

		const progressText = `📊 Streaming: ${this.tokenCount} tokens | ${this.currentText.length} chars | ${charRate} chars/sec | ${chunkCount} chunks`

		if (this.settings.enableStreamingMetrics) {
			const errorRate = this.errorCount > 0 ? `| ${this.errorCount} errors` : ''
			const retryInfo = this.retryCount > 0 ? `| ${this.retryCount} retries` : ''
			this.progressNode.setText(`${progressText} ${errorRate} ${retryInfo}`)
		} else {
			this.progressNode.setText(progressText)
		}
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
	onToken = (token: string) => {
		if (this.isCompleted || this.isPaused) return

		this.currentText += token
		this.tokenCount++

		// Update progress
		this.updateProgress()

		// Throttled updates to prevent overwhelming the UI
		const now = Date.now()
		if (now - this.lastUpdateTime >= this.settings.streamingUpdateInterval && !this.pendingUpdate) {
			this.pendingUpdate = true
			this.scheduleUpdate()
		}

		// Check if we should split into a new chunk
		if (this.settings.enableStreamingSplit && this.shouldCreateNewChunk()) {
			this.createNewChunk()
		}
	}

	/**
	 * Handle completion of streaming
	 */
	onComplete = (fullText: string) => {
		this.isCompleted = true
		this.currentText = fullText

		// Final update
		this.updateCurrentNode()
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

		// If we have multiple chunks, create the mindmap layout
		if (this.chunks.length > 1 && this.settings.enableStreamingSplit) {
			this.finalizeMindmap()
		}

		this.logDebug(`Streaming completed with ${this.createdNodes.length} nodes, ${this.tokenCount} tokens`)
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
		if (this.currentNode) {
			this.currentNode.setText(`❌ Streaming failed after ${this.retryCount} retries: ${error.message}`)
		}

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
			this.updateCurrentNode()
			this.lastUpdateTime = Date.now()
			this.pendingUpdate = false
		}, Math.max(0, this.settings.streamingUpdateInterval - (Date.now() - this.lastUpdateTime)))
	}

	/**
	 * Update the current node with latest text
	 */
	private updateCurrentNode() {
		if (!this.currentNode || this.isCompleted) return

		// Update text with streaming indicator
		const displayText = this.isCompleted ? this.currentText : `${this.currentText}●`
		this.currentNode.setText(displayText)

		// Resize node based on content
		const newHeight = calcHeight({
			text: displayText,
			parentHeight: this.parentNode.height
		})

		this.currentNode.moveAndResize({
			height: newHeight,
			width: this.currentNode.width,
			x: this.currentNode.x,
			y: this.currentNode.y
		})
	}

	/**
	 * Determine if we should create a new chunk/node
	 */
	private shouldCreateNewChunk(): boolean {
		if (!this.settings.enableStreamingSplit) return false

		// Don't create too many chunks
		if (this.chunks.length >= (this.settings.maxSplitNotes || 6)) return false

		// Check if current text is long enough for a new chunk
		const currentChunkText = this.getCurrentChunkText()
		if (currentChunkText.length < this.settings.streamingChunkSize) return false

		// Look for natural break points
		const recentText = this.currentText.slice(-100) // Last 100 chars

		// Check for structural breaks
		const hasStructuralBreak = !!(recentText.includes('\n\n') ||
			recentText.includes('##') ||
			recentText.match(/\d+\.\s/) ||
			recentText.includes('```'))

		// Check for sentence boundaries
		const hasSentenceBreak = !!recentText.match(/[.!?]\s+[A-Z]/)

		return hasStructuralBreak || (hasSentenceBreak && currentChunkText.length > this.settings.streamingChunkSize * 1.5)
	}

	/**
	 * Get text for current chunk
	 */
	private getCurrentChunkText(): string {
		const lastChunkEnd = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
		return this.currentText.slice(lastChunkEnd)
	}

	/**
	 * Create a new chunk/node during streaming
	 */
	private createNewChunk() {
		const currentChunkText = this.getCurrentChunkText().trim()
		if (currentChunkText.length < 50) return // Too small to split

		// Finalize current chunk
		this.chunks.push(currentChunkText)

		// Update current node with final chunk text
		if (this.currentNode) {
			this.currentNode.setText(currentChunkText)
		}

		// Create new node for continuing stream
		const newNode = createNode(
			this.canvas,
			this.parentNode,
			{
				text: '●', // Streaming indicator
				size: { height: emptyNoteHeight }
			},
			{
				color: assistantColor,
				chat_role: 'assistant'
			}
		)

		this.currentNode = newNode
		this.createdNodes.push(newNode)

		this.logDebug(`Created new streaming chunk ${this.chunks.length}, continuing stream...`)
	}

	/**
	 * Finalize mindmap layout after streaming completes
	 */
	private async finalizeMindmap() {
		try {
			// Add the final chunk
			const finalChunkText = this.getCurrentChunkText().trim()
			if (finalChunkText) {
				this.chunks.push(finalChunkText)
			}

			// Remove individual nodes and create proper mindmap
			for (const node of this.createdNodes) {
				this.canvas.removeNode(node)
			}

			// Create summary/parent node with performance metrics if enabled
			let summaryText = `AI Response (${this.chunks.length} parts)\n\n${this.chunks[0].substring(0, 150)}...`

			if (this.settings.enableStreamingMetrics) {
				const elapsed = (Date.now() - this.startTime) / 1000
				const tokensPerSecond = this.tokenCount > 0 && elapsed > 0 ? Math.round(this.tokenCount / elapsed) : 0
				const charsPerSecond = this.currentText.length > 0 && elapsed > 0 ? Math.round(this.currentText.length / elapsed) : 0

				summaryText += `\n\n📊 Streaming Performance:\n• ${this.tokenCount} tokens in ${elapsed.toFixed(1)}s\n• ${tokensPerSecond} tokens/sec, ${charsPerSecond} chars/sec`

				if (this.retryCount > 0) {
					summaryText += `\n• ${this.retryCount} retries required`
				}
			}

			const summaryNode = createNode(
				this.canvas,
				this.parentNode,
				{
					text: summaryText,
					size: { height: calcHeight({ text: summaryText, parentHeight: this.parentNode.height }) }
				},
				{
					color: assistantColor,
					chat_role: 'assistant'
				}
			)

			// Create mindmap layout
			await createMindmapNodes(this.canvas, summaryNode, this.chunks, this.logDebug, this.settings)

			// Select the summary node
			this.canvas.selectOnly(summaryNode, false)

		} catch (error) {
			this.logDebug('Error finalizing mindmap:', error)
		}
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
	 * Stop streaming completely
	 */
	stop() {
		this.isCompleted = true
		this.isPaused = false

		if (this.currentNode) {
			this.currentNode.setText(this.currentText + '\n\n⏹️ Streaming stopped by user')
		}

		// Clean up control and progress nodes
		if (this.controlNode) {
			this.canvas.removeNode(this.controlNode)
			this.controlNode = null
		}

		if (this.progressNode) {
			this.canvas.removeNode(this.progressNode)
			this.progressNode = null
		}

		this.logDebug('Streaming stopped by user')
	}
}

export function noteGenerator(
	app: App,
	settings: ChatStreamSettings,
	logDebug: Logger
) {
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
		if (!canCallAI()) return

		logDebug('Creating AI note')

		const canvas = getActiveCanvas()
		if (!canvas) {
			logDebug('No active canvas')
			return
		}

		await canvas.requestFrame()

		const selection = canvas.selection
		if (selection?.size !== 1) return // TODO: handle multiple nodes
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

					// StreamingHandler manages the final state, so we can return here
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

				// Check if auto-split is enabled and response is long enough to split
				if (settings.enableAutoSplit && generated.length > 200) {
					const sections = splitIntoSections(generated, settings.maxSplitNotes || 0)

					if (sections.length > 1) {
						logDebug(`Auto-splitting response into ${sections.length} sections`)

						// Remove the placeholder node since we'll create multiple nodes
						canvas.removeNode(created)

						// Create a summary node with the first section or a brief overview
						const summaryText = sections.length > 3
							? `AI Response Summary (${sections.length} parts)\n\n${sections[0].substring(0, 150)}...`
							: sections[0]

						const summaryNode = createNode(
							canvas,
							node,
							{
								text: summaryText,
								size: { height: calcHeight({ text: summaryText, parentHeight: node.height }) }
							},
							{
								color: assistantColor,
								chat_role: 'assistant'
							}
						)

						// Create mindmap nodes for all sections
						const mindmapNodes = await createMindmapNodes(canvas, summaryNode, sections, logDebug, settings)

						new Notice(`Created mindmap with ${mindmapNodes.length} notes`)

						// Select the summary node
						const selectedNoteId =
							canvas.selection?.size === 1
								? Array.from(canvas.selection.values())?.[0]?.id
								: undefined

						if (selectedNoteId === node?.id || selectedNoteId == null) {
							canvas.selectOnly(summaryNode, false /* startEditing */)
						}

						await canvas.requestSave()
						return
					}
				}

				// Fallback to original single-node behavior
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

				const selectedNoteId =
					canvas.selection?.size === 1
						? Array.from(canvas.selection.values())?.[0]?.id
						: undefined

				if (selectedNoteId === node?.id || selectedNoteId == null) {
					// If the user has not changed selection, select the created node
					canvas.selectOnly(created, false /* startEditing */)
				}
			} catch (error) {
				new Notice(`Error calling AI: ${error.message || error}`)
				canvas.removeNode(created)
			}

			await canvas.requestSave()
		}
	}

	const generateMindmapNote = async () => {
		if (!canCallAI()) return

		logDebug('Creating AI mindmap')

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
					text: `Calling AI for mindmap (${settings.apiModel})...`,
					size: { height: placeholderNoteHeight }
				},
				{
					color: assistantColor,
					chat_role: 'assistant'
				}
			)

			new Notice(
				`Sending ${messages.length} notes with ${tokenCount} tokens to AI for mindmap`
			)

			try {
				logDebug('messages', messages)

				// Use streaming if enabled
				if (settings.enableStreaming) {
					// For mindmap mode, always enable streaming split
					const mindmapSettings = {
						...settings,
						enableStreamingSplit: true
					}

					const streamingHandler = new StreamingHandler(
						canvas,
						node,
						created,
						mindmapSettings,
						logDebug
					)

					new Notice(`Streaming ${settings.apiModel} response for mindmap...`)

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

				// Always split for mindmap, regardless of settings
				const sections = splitIntoSections(generated, settings.maxSplitNotes || 6)

				if (sections.length > 1) {
					logDebug(`Creating mindmap with ${sections.length} sections`)

					// Remove the placeholder node since we'll create multiple nodes
					canvas.removeNode(created)

					// Create a summary node
					const summaryText = `AI Mindmap Response (${sections.length} parts)\n\n${sections[0].substring(0, 150)}...`

					const summaryNode = createNode(
						canvas,
						node,
						{
							text: summaryText,
							size: { height: calcHeight({ text: summaryText, parentHeight: node.height }) }
						},
						{
							color: assistantColor,
							chat_role: 'assistant'
						}
					)

					// Create mindmap nodes for all sections
					const mindmapNodes = await createMindmapNodes(canvas, summaryNode, sections, logDebug, settings)

					new Notice(`Created mindmap with ${mindmapNodes.length} notes`)

					// Select the summary node
					const selectedNoteId =
						canvas.selection?.size === 1
							? Array.from(canvas.selection.values())?.[0]?.id
							: undefined

					if (selectedNoteId === node?.id || selectedNoteId == null) {
						canvas.selectOnly(summaryNode, false /* startEditing */)
					}
				} else {
					// Fallback to single note if splitting didn't work
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
				}
			} catch (error) {
				new Notice(`Error calling AI: ${error.message || error}`)
				canvas.removeNode(created)
			}

			await canvas.requestSave()
		}
	}

	return { nextNote, generateNote, generateMindmapNote }
}

function getEncoding(settings: ChatStreamSettings) {
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

function getTokenLimit(settings: ChatStreamSettings) {
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
