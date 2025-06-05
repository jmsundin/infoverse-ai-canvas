# Getting Started with AI Canvas and Markdown Splitting

This document demonstrates how the new langchain recursive markdown splitter works to create parent-child hierarchical notes.

## Overview

The markdown splitter analyzes your markdown content and creates a hierarchy based on header levels:

- # Header 1 becomes the root node
- ## Header 2 becomes a child of the nearest Header 1
- ### Header 3 becomes a child of the nearest Header 2
- And so on...

## Key Features

### Intelligent Chunking

The splitter uses langchain's RecursiveCharacterTextSplitter to:

- Respect header boundaries
- Maintain context with configurable overlap
- Handle nested content appropriately

#### Configurable Parameters

You can customize the splitting behavior through settings:

- **Chunk Size**: Maximum characters per chunk (default: 1000)
- **Chunk Overlap**: Characters to overlap between chunks (default: 200)
- **Keep Separators**: Whether to preserve header markers (default: true)

### Visual Hierarchy

When enabled, the plugin creates:

1. **Parent-child relationships**: Directed edges showing the hierarchy
2. **Spatial layout**: Nodes positioned based on their hierarchy level
3. **Tree visualization**: Optional text-based tree structure display

#### Layout Configuration

- **Hierarchy Spacing**: Horizontal spacing between levels (default: 300px)
- **Enable Hierarchy**: Toggle parent-child edge creation
- **Show Tree Visualization**: Display structure overview

## Usage Instructions

### Prerequisites

1. Enable markdown splitting in plugin settings
2. Configure chunk size and overlap as needed
3. Ensure you have content with markdown headers

### Step-by-Step Process

#### Step 1: Prepare Your Content

Create a note with hierarchical markdown content using headers:

```markdown
# Main Topic

Content for main topic...

## Subtopic A

Content for subtopic A...

### Detail A1

Content for detail A1...

## Subtopic B

Content for subtopic B...
```

#### Step 2: Run the Splitter

1. Select the note containing your markdown
2. Use the command: "Split markdown into hierarchical notes"
3. Or use the hotkey: Alt+Shift+S

#### Step 3: Review Results

The plugin will create:

- Individual notes for each section
- Parent-child connections (if enabled)
- A tree visualization (if enabled)

## Advanced Usage

### Integration with AI Responses

The markdown splitter works particularly well with AI-generated content:

1. Generate content using the AI commands
2. Apply markdown splitting to create structured knowledge maps
3. Use the hierarchical structure for further exploration

### Best Practices

#### Content Organization

- Use consistent header levels
- Keep sections reasonably sized
- Include meaningful header text

#### Settings Optimization

- Adjust chunk size based on your content length
- Use overlap to maintain context between chunks
- Enable hierarchy visualization for complex documents

## Technical Details

### Implementation

The splitter is built using:

- **Langchain**: For robust text splitting algorithms
- **TypeScript**: For type safety and maintainability
- **Obsidian Canvas API**: For creating visual relationships

### Configuration Options

All settings are accessible through the plugin settings tab under "Markdown Splitting":

- Enable/disable the feature
- Adjust chunking parameters
- Control visual presentation
- Configure hierarchy behavior

## Conclusion

The markdown splitter transforms flat documents into interactive, hierarchical knowledge structures that make it easier to navigate and understand complex information.

Try it out with this example document to see how it creates parent-child relationships based on the header structure!
