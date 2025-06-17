import { ItemView } from 'obsidian'
import { AllCanvasNodeData } from 'obsidian/canvas'
import { randomHexString } from '../utils'
import { Canvas, CanvasNode, CreateNodeOptions } from './canvas-internal'

export interface CanvasEdgeIntermediate {
	fromOrTo: string
	side: string
	node: CanvasElement
}

interface CanvasElement {
	id: string
}

export type CanvasView = ItemView & {
	canvas: Canvas
}

/**
 * Minimum width for new notes
 */
const minWidth = 360

/**
 * Assumed pixel height per line
 */
const pxPerLine = 28

/**
 * Assumed height of top + bottom text area padding
 */
const textPaddingHeight = 12

/**
 * Margin between new notes
 */
const newNoteMargin = 60

/**
 * Min height of new notes
 */
const minHeight = 60

/**
 * Choose height for generated note based on actual number of lines in the text.
 * Each line gets pxPerLine height plus padding.
 */

export const calcHeight = (options: { parentHeight: number; text: string }) => {
	// Split text into segments by newline characters
	const segments = options.text.split('\n')

	// Assume average characters per line based on typical font and width
	// This is an approximation - in a real implementation you'd want to measure actual text
	const avgCharsPerLine = 50 // Approximate characters that fit in minWidth (360px)

	let totalVisualLines = 0

	segments.forEach(segment => {
		if (segment.trim() === '') {
			// Empty line still takes up one visual line
			totalVisualLines += 1
		} else {
			// Calculate how many visual lines this segment will take
			const segmentLength = segment.length
			const visualLinesForSegment = Math.ceil(segmentLength / avgCharsPerLine)
			totalVisualLines += Math.max(1, visualLinesForSegment)
		}
	})

	// Calculate height based on total visual lines
	const calcTextHeight = Math.round(
		textPaddingHeight + (pxPerLine * totalVisualLines)
	)

	return Math.max(minHeight, calcTextHeight)
}

/**
 * Determine the best position for a new node relative to its parent
 */
const determineNodePosition = (
	canvas: Canvas,
	parentNode: CanvasNode,
	nodeOptions: CreateNodeOptions
) => {
	const { text } = nodeOptions
	const width = nodeOptions?.size?.width || Math.max(minWidth, parentNode?.width)
	const height = nodeOptions?.size?.height || calcHeight({ text, parentHeight: parentNode.height })

	// Get existing children of the parent
	const children = canvas
		.getEdgesForNode(parentNode)
		.filter((edge) => edge.from.node.id === parentNode.id)
		.map((edge) => edge.to.node)

	// If no children, place to the right
	if (children.length === 0) {
		return {
			x: parentNode.x + parentNode.width + newNoteMargin,
			y: parentNode.y + (parentNode.height - height) / 2,
			width,
			height,
			fromSide: 'right' as const,
			toSide: 'left' as const
		}
	}

	// Analyze existing children positions to determine the best placement
	const positions = {
		right: children.filter(child => child.x > parentNode.x + parentNode.width),
		left: children.filter(child => child.x + child.width < parentNode.x),
		top: children.filter(child => child.y + child.height < parentNode.y),
		bottom: children.filter(child => child.y > parentNode.y + parentNode.height)
	}

	// Find the direction with the least nodes, preferring right, then bottom, then top, then left
	const directionPriority = ['right', 'bottom', 'top', 'left'] as const
	const chosenDirection = directionPriority.find(dir => positions[dir].length === 0) ||
		directionPriority.reduce((min, dir) =>
			positions[dir].length < positions[min].length ? dir : min
		)

	let x: number, y: number, fromSide: string, toSide: string

	switch (chosenDirection) {
		case 'right': {
			const rightmostX = Math.max(
				parentNode.x + parentNode.width,
				...positions.right.map(child => child.x + child.width)
			)
			x = rightmostX + newNoteMargin
			y = parentNode.y + (parentNode.height - height) / 2
			fromSide = 'right'  // Edge leaves from right side of parent
			toSide = 'left'     // Edge enters left side of right child
			break
		}

		case 'left': {
			const leftmostX = Math.min(
				parentNode.x,
				...positions.left.map(child => child.x)
			)
			x = leftmostX - width - newNoteMargin
			y = parentNode.y + (parentNode.height - height) / 2
			fromSide = 'left'   // Edge leaves from left side of parent
			toSide = 'right'    // Edge enters right side of left child
			break
		}

		case 'top': {
			const topmostY = Math.min(
				parentNode.y,
				...positions.top.map(child => child.y)
			)
			x = parentNode.x + (parentNode.width - width) / 2
			y = topmostY - height - newNoteMargin
			fromSide = 'top'    // Edge leaves from top side of parent
			toSide = 'bottom'   // Edge enters bottom side of top child
			break
		}

		case 'bottom': {
			const bottommostY = Math.max(
				parentNode.y + parentNode.height,
				...positions.bottom.map(child => child.y + child.height)
			)
			x = parentNode.x + (parentNode.width - width) / 2
			y = bottommostY + newNoteMargin
			fromSide = 'bottom' // Edge leaves from bottom side of parent
			toSide = 'top'      // Edge enters top side of bottom child
			break
		}

		default: {
			// Fallback to right
			x = parentNode.x + parentNode.width + newNoteMargin
			y = parentNode.y + (parentNode.height - height) / 2
			fromSide = 'right'
			toSide = 'left'
		}
	}

	return { x, y, width, height, fromSide, toSide }
}

/**
 * Create new node as descendant from the parent node.
 * Intelligently positions the node and creates proper edge connections.
 */
export const createNode = (
	canvas: Canvas,
	parentNode: CanvasNode,
	nodeOptions: CreateNodeOptions,
	nodeData?: Partial<AllCanvasNodeData>
) => {
	if (!canvas) {
		throw new Error('Invalid arguments')
	}

	const position = determineNodePosition(canvas, parentNode, nodeOptions)

	const newNode = canvas.createTextNode({
		pos: { x: position.x, y: position.y },
		position: 'left',
		size: { height: position.height, width: position.width },
		text: nodeOptions.text,
		focus: false
	})

	if (nodeData) {
		newNode.setData(nodeData)
	}

	canvas.deselectAll()
	canvas.addNode(newNode)

	addEdge(
		canvas,
		randomHexString(16),
		{
			fromOrTo: 'from',
			side: position.fromSide,
			node: parentNode
		},
		{
			fromOrTo: 'to',
			side: position.toSide,
			node: newNode
		}
	)

	return newNode
}

/**
 * Add edge entry to canvas.
 */
export const addEdge = (
	canvas: Canvas,
	edgeID: string,
	fromEdge: CanvasEdgeIntermediate,
	toEdge: CanvasEdgeIntermediate
) => {
	if (!canvas) return

	const data = canvas.getData()

	if (!data) return

	canvas.importData({
		edges: [
			...data.edges,
			{
				id: edgeID,
				fromNode: fromEdge.node.id,
				fromSide: fromEdge.side,
				toNode: toEdge.node.id,
				toSide: toEdge.side
			}
		],
		nodes: data.nodes
	})

	canvas.requestFrame()
}

/**
 * Trap exception and write to console.error.
 */
export function trapError<T>(fn: (...params: unknown[]) => T) {
	return (...params: unknown[]) => {
		try {
			return fn(...params)
		} catch (e) {
			console.error(e)
		}
	}
}

// Add helper to create a group (frame) node on the canvas
export const createGroup = (
	canvas: Canvas,
	options: {
		label: string
		pos: { x: number; y: number }
		size: { width: number; height: number }
		color?: string
	}
) => {
	if (!canvas) throw new Error('Invalid canvas')

	const data = canvas.getData()
	const groupId = randomHexString(16)

	canvas.importData({
		nodes: [
			...data.nodes,
			{
				id: groupId,
				type: 'group',
				label: options.label,
				x: options.pos.x,
				y: options.pos.y,
				width: options.size.width,
				height: options.size.height,
				color: options.color || undefined
			}
		],
		edges: data.edges
	})

	canvas.requestFrame()

	// Groups are rendered as a special node type; return its ID so callers can update it later
	return groupId
}

// Update an existing group node (re-imports canvas data with modifications)
export const updateGroup = (
	canvas: Canvas,
	groupId: string,
	updates: Partial<{ x: number; y: number; width: number; height: number; label: string; color: string }>
) => {
	if (!canvas) return
	const data = canvas.getData()
	const newNodes = data.nodes.map(n => (n.id === groupId ? { ...n, ...updates } : n))
	canvas.importData({ nodes: newNodes, edges: data.edges })
	canvas.requestFrame()
}
