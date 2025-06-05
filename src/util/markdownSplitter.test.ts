import { HierarchicalMarkdownSplitter, RecursiveMarkdownSplitter, splitMarkdownForCanvas } from './markdownSplitter'

describe('HierarchicalMarkdownSplitter', () => {
    const testMarkdown = `# Getting Started

This is the introduction to our document with some content.

## Overview

The overview section provides a high-level view of the system.

### Key Points

Here are the most important points to remember:

- Point 1: Understanding the basics
- Point 2: Implementation strategy
- Point 3: Best practices

### Implementation Details

This section contains implementation specifics that developers need to know.

#### Technical Requirements

The technical requirements include:

- TypeScript for type safety
- Langchain for text processing
- Obsidian for the plugin platform

## Conclusion

This is the conclusion section that wraps up our discussion.

### Final Thoughts

Some concluding remarks about the implementation.
`

    test('should split markdown into header-based hierarchical nodes', async () => {
        const splitter = new HierarchicalMarkdownSplitter({
            chunkSize: 200,
            chunkOverlap: 50,
            maxHeaderLevel: 6
        })

        const result = await splitter.splitMarkdown(testMarkdown)

        // Should create nodes for each header section
        expect(result.nodes.length).toBeGreaterThan(3)

        // Should have edges connecting parent-child relationships
        expect(result.edges.length).toBeGreaterThan(0)

        // Should identify root nodes (H1 headers)
        expect(result.rootNodes.length).toBe(1)

        // Verify the root node is the H1 header
        const rootNode = result.nodes.find(n => n.id === result.rootNodes[0])
        expect(rootNode).toBeDefined()
        expect(rootNode!.headerLevel).toBe(1)
        expect(rootNode!.headerText).toBe('Getting Started')
        expect(rootNode!.content).toContain('# Getting Started')
        expect(rootNode!.content).toContain('This is the introduction')
    })

    test('should create proper header-based parent-child relationships', async () => {
        const splitter = new HierarchicalMarkdownSplitter({
            maxHeaderLevel: 6
        })

        const result = await splitter.splitMarkdown(testMarkdown)

        // Find the Overview node (H2)
        const overviewNode = result.nodes.find(n => n.headerText === 'Overview')
        expect(overviewNode).toBeDefined()
        expect(overviewNode!.headerLevel).toBe(2)

        // Overview should have children (H3 sections)
        expect(overviewNode!.children.length).toBeGreaterThan(0)

        // Find a Key Points node (H3)
        const keyPointsNode = result.nodes.find(n => n.headerText === 'Key Points')
        expect(keyPointsNode).toBeDefined()
        expect(keyPointsNode!.headerLevel).toBe(3)
        expect(keyPointsNode!.parentId).toBe(overviewNode!.id)

        // Key Points content should not contain Implementation Details content
        expect(keyPointsNode!.content).toContain('### Key Points')
        expect(keyPointsNode!.content).toContain('Point 1: Understanding')
        expect(keyPointsNode!.content).not.toContain('### Implementation Details')
        expect(keyPointsNode!.content).not.toContain('implementation specifics')
    })

    test('should not include sub-header content in parent headers', async () => {
        const splitter = new HierarchicalMarkdownSplitter({
            maxHeaderLevel: 6
        })

        const result = await splitter.splitMarkdown(testMarkdown)

        // Find the Overview node (H2)
        const overviewNode = result.nodes.find(n => n.headerText === 'Overview')
        expect(overviewNode).toBeDefined()

        // Overview content should not contain H3 header content
        expect(overviewNode!.content).toContain('## Overview')
        expect(overviewNode!.content).toContain('high-level view')
        expect(overviewNode!.content).not.toContain('### Key Points')
        expect(overviewNode!.content).not.toContain('### Implementation Details')

        // Find the Implementation Details node (H3)
        const implNode = result.nodes.find(n => n.headerText === 'Implementation Details')
        expect(implNode).toBeDefined()

        // Implementation Details should not contain H4 content
        expect(implNode!.content).toContain('### Implementation Details')
        expect(implNode!.content).toContain('implementation specifics')
        expect(implNode!.content).not.toContain('#### Technical Requirements')
        expect(implNode!.content).not.toContain('TypeScript for type safety')
    })

    test('should handle deep header hierarchies correctly', async () => {
        const splitter = new HierarchicalMarkdownSplitter({
            maxHeaderLevel: 6
        })

        const result = await splitter.splitMarkdown(testMarkdown)

        // Find the Technical Requirements node (H4)
        const techReqNode = result.nodes.find(n => n.headerText === 'Technical Requirements')
        expect(techReqNode).toBeDefined()
        expect(techReqNode!.headerLevel).toBe(4)

        // Should be a child of Implementation Details (H3)
        const implNode = result.nodes.find(n => n.headerText === 'Implementation Details')
        expect(techReqNode!.parentId).toBe(implNode!.id)

        // Should contain its own content but not sibling content
        expect(techReqNode!.content).toContain('#### Technical Requirements')
        expect(techReqNode!.content).toContain('TypeScript for type safety')
        expect(techReqNode!.content).toContain('Langchain for text processing')
    })

    test('should respect maxHeaderLevel configuration', async () => {
        const splitter = new HierarchicalMarkdownSplitter({
            maxHeaderLevel: 3 // Only process up to H3
        })

        const result = await splitter.splitMarkdown(testMarkdown)

        // Should not create nodes for H4 headers
        const techReqNode = result.nodes.find(n => n.headerText === 'Technical Requirements')
        expect(techReqNode).toBeUndefined()

        // But H3 nodes should still exist
        const keyPointsNode = result.nodes.find(n => n.headerText === 'Key Points')
        expect(keyPointsNode).toBeDefined()
        expect(keyPointsNode!.headerLevel).toBe(3)
    })

    test('should generate improved tree visualization', async () => {
        const splitter = new HierarchicalMarkdownSplitter({
            maxHeaderLevel: 6
        })
        const result = await splitter.splitMarkdown(testMarkdown)

        const visualization = splitter.getTreeVisualization(result)

        expect(visualization).toBeTruthy()
        expect(visualization).toContain('# Getting Started')
        expect(visualization).toContain('## Overview')
        expect(visualization).toContain('### Key Points')
        // Should contain hierarchy indicators
        expect(visualization).toMatch(/📚|📖|📝/)
        // Should show proper indentation
        expect(visualization).toContain('  📖 ## Overview')
        expect(visualization).toContain('    📝 ### Key Points')
    })

    test('should work with splitMarkdownForCanvas helper', async () => {
        const result = await splitMarkdownForCanvas(testMarkdown, {
            chunkSize: 150,
            chunkOverlap: 30,
            maxHeaderLevel: 6
        })

        expect(result.nodes.length).toBeGreaterThan(3)
        expect(result.edges.length).toBeGreaterThan(0)
        expect(result.visualization).toBeTruthy()

        // Verify canvas node structure
        const canvasNodes = result.nodes
        expect(canvasNodes[0]).toHaveProperty('position')
        expect(canvasNodes[0]).toHaveProperty('level')
        expect(canvasNodes[0]).toHaveProperty('content')
        expect(canvasNodes[0]).toHaveProperty('parentId')

        // Verify hierarchical positioning
        const rootNodes = canvasNodes.filter(n => !n.parentId)
        expect(rootNodes.length).toBe(1)
        expect(rootNodes[0].position?.x).toBe(0) // Root should be at x=0

        // Child nodes should be positioned further right
        const childNodes = canvasNodes.filter(n => n.parentId)
        if (childNodes.length > 0) {
            expect(childNodes[0].position?.x).toBeGreaterThan(0)
        }
    })

    test('should handle content without headers', async () => {
        const splitter = new HierarchicalMarkdownSplitter()

        // Plain text without headers
        const plainText = 'Just some plain text without any headers. This should still create a node.'
        const result = await splitter.splitMarkdown(plainText)

        expect(result.nodes).toHaveLength(1)
        expect(result.nodes[0].headerLevel).toBe(0)
        expect(result.nodes[0].headerText).toBe('Introduction')
        expect(result.nodes[0].content).toBe(plainText)
        expect(result.edges).toHaveLength(0)
    })

    test('should handle empty markdown', async () => {
        const splitter = new HierarchicalMarkdownSplitter()

        const emptyResult = await splitter.splitMarkdown('')
        expect(emptyResult.nodes).toHaveLength(0)
        expect(emptyResult.edges).toHaveLength(0)
        expect(emptyResult.rootNodes).toHaveLength(0)
    })

    test('should maintain backward compatibility with RecursiveMarkdownSplitter', async () => {
        const splitter = new RecursiveMarkdownSplitter({
            maxHeaderLevel: 6
        })

        const result = await splitter.splitMarkdown(testMarkdown)

        // Should work the same as HierarchicalMarkdownSplitter
        expect(result.nodes.length).toBeGreaterThan(3)
        expect(result.edges.length).toBeGreaterThan(0)
        expect(result.rootNodes.length).toBe(1)

        const rootNode = result.nodes.find(n => n.id === result.rootNodes[0])
        expect(rootNode!.headerLevel).toBe(1)
        expect(rootNode!.headerText).toBe('Getting Started')
    })
})

describe('Canvas Integration', () => {
    test('should produce correct positioning for canvas nodes', async () => {
        const testMd = `# Root

Root content.

## Child 1

Child 1 content.

### Grandchild 1

Grandchild content.

## Child 2

Child 2 content.`

        const result = await splitMarkdownForCanvas(testMd, { maxHeaderLevel: 6 })

        // Should have hierarchical positioning
        const rootNode = result.nodes.find(n => n.level === 1)
        const child1Node = result.nodes.find(n => n.level === 2)
        const grandchild = result.nodes.find(n => n.level === 3)

        expect(rootNode?.position?.x).toBe(0)
        expect(child1Node?.position?.x).toBe(300) // One level deeper
        expect(grandchild?.position?.x).toBe(600) // Two levels deeper

        // Y positions should be sequential
        expect(rootNode?.position?.y).toBe(0)
        expect(child1Node?.position?.y).toBe(180)
        expect(grandchild?.position?.y).toBe(360)
    })
})
