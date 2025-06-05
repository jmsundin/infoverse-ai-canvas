# Header-Based Tree Splitting Implementation

## Overview

I have successfully replaced the threshold-based live splitting system with a pure **header-based splitting** approach that maintains a **hierarchical tree data structure**. This new system creates visual tree or mindmap representations of streaming AI responses based on markdown headers.

## Key Changes Made

### 1. Removed Threshold-Based Logic

- ❌ Removed `splitThreshold` property and related checks
- ❌ Removed LangChain `RecursiveCharacterTextSplitter` dependency for live splitting
- ❌ Removed chunk-size based splitting logic

### 2. Implemented Tree Data Structure

- ✅ Added `TreeNode` interface with hierarchical properties:
  ```typescript
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
  ```

### 3. Header-Based Parsing

- ✅ Created `parseHeaders()` method that scans for markdown headers (#, ##, ###, etc.)
- ✅ Immediately detects headers as they appear in streaming content
- ✅ Creates tree nodes maintaining proper parent-child relationships

### 4. Real-Time Tree Building

- ✅ `tryHeaderBasedSplit()` processes new headers as they stream in
- ✅ `processNewHeader()` creates tree nodes and canvas nodes
- ✅ `findParentForLevel()` maintains proper hierarchy based on header levels

### 5. Visual Tree Layout

- ✅ `calculateTreePosition()` positions nodes in a tree layout
- ✅ Children are positioned to the right of their parents
- ✅ Proper spacing between sibling nodes
- ✅ Color coding based on header levels:
  - H1: Red
  - H2: Green
  - H3: Purple
  - H4: Pink
  - H5: Yellow
  - H6: Default purple

### 6. Content Management

- ✅ `getContentForTreeNode()` determines what content belongs to each node
- ✅ Content is automatically split at header boundaries
- ✅ Each node contains only content from its header to the next header at the same or higher level

## How It Works

### Stream Processing Flow

1. **Token Arrival**: AI tokens stream in via `onToken()`
2. **Header Detection**: `parseHeaders()` scans for new markdown headers
3. **Tree Node Creation**: New headers trigger `processNewHeader()`
4. **Canvas Node Creation**: `createCanvasNodeForTreeNode()` creates visual nodes
5. **Content Updates**: `updateCurrentActiveNode()` updates nodes with new content
6. **Hierarchy Maintenance**: Parent-child relationships are maintained automatically

### Tree Structure Example

```
🌳 Root
  📚 # Introduction
  📚 # Main Features
    📖 ## Real-Time Detection
    📖 ## Tree Structure
      📝 ### Implementation Details
        📝 #### Technical Requirements
  📚 # Conclusion
```

### Visual Layout Example

```
[Root] → [Introduction]
       → [Main Features] → [Real-Time Detection]
                        → [Tree Structure] → [Implementation Details] → [Technical Requirements]
       → [Conclusion]
```

## Benefits

### 1. **Pure Header-Based Splitting**

- No arbitrary thresholds or character limits
- Clean splits at semantic boundaries (headers)
- Respects markdown document structure

### 2. **Hierarchical Tree Structure**

- Maintains true parent-child relationships
- Proper nesting based on header levels
- Can be traversed and manipulated programmatically

### 3. **Visual Tree/Mindmap Representation**

- Nodes positioned in tree layout
- Color-coded by hierarchy level
- Connected with edges showing relationships
- Perfect for mindmap visualization

### 4. **Real-Time Processing**

- Headers detected immediately as they stream
- Tree structure built incrementally
- Live updates to existing nodes

### 5. **Debugging Support**

- `getTreeVisualization()` provides ASCII tree view
- `getTreeStructure()` returns raw tree data
- Debug utilities available for inspection

## Usage

### For Users

1. Enable "Markdown Splitting" and "Streaming Split" in settings
2. Ask AI to generate content with markdown headers
3. Watch as the content automatically splits into a hierarchical tree structure
4. Navigate the visual tree/mindmap of the AI response

### For Developers

```typescript
// Access the tree structure after streaming
const { getLastTreeVisualization, getLastTreeStructure } = noteGenerator(...)

// Get ASCII visualization
console.log(getLastTreeVisualization())

// Get raw tree data
const tree = getLastTreeStructure()
```

## Configuration

The system respects existing settings:

- `enableMarkdownSplitting`: Enables the feature
- `enableStreamingSplit`: Enables live splitting during streaming
- `enableMarkdownHierarchy`: Creates edges between nodes
- `markdownHierarchySpacing`: Controls horizontal spacing between levels

## Technical Implementation

### Core Components

1. **StreamingHandler**: Manages the streaming process and tree building
2. **TreeNode**: Data structure representing hierarchical nodes
3. **Header Parser**: Detects markdown headers in real-time
4. **Tree Builder**: Maintains parent-child relationships
5. **Canvas Integration**: Creates and positions visual nodes

### Key Algorithms

- **Header Detection**: Regex-based markdown header parsing
- **Hierarchy Resolution**: Stack-based parent finding algorithm
- **Tree Positioning**: Recursive layout calculation
- **Content Segmentation**: Header boundary-based content splitting

This implementation provides a much cleaner, more intuitive approach to creating hierarchical visualizations of AI-generated content, perfect for building mindmaps and tree structures from streaming markdown content.
