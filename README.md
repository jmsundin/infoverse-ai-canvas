# Infoverse AI Canvas 🔀

![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/jmsundin/infoverse-ai-canvas?style=for-the-badge&sort=semver) [![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22infoverse-ai-canvas%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=for-the-badge)](https://obsidian.md/plugins?search=infoverse%20ai%20canvas)

An Obsidian plugin for conversing with AI via canvas notes. Ancestor notes/files are included in the chat context. You can quickly create chat streams, and control what other notes are sent to the AI.

<img src="static/chat-stream-example.gif"/>

## Install

Install as [community plugin](https://obsidian.md/plugins?search=infoverse%20ai%20canvas#)

Or, add `jmsundin/infoverse-ai-canvas` to [BRAT](https://github.com/TfTHacker/obsidian42-brat).

Infoverse AI Canvas is supported only on desktop.

## Setup

Add an [OpenAI API key](https://platform.openai.com/account/api-keys) in Chat Stream settings.

## Configuration

### Streaming Settings

The plugin offers extensive streaming customization options:

#### Basic Streaming

- **Enable Streaming**: Toggle real-time response display
- **Streaming Split**: Auto-create new nodes during streaming
- **Update Interval**: Control how frequently the UI updates (default: 500ms)
- **Chunk Size**: Minimum text length before creating new nodes (default: 100 chars)

#### Advanced Streaming

- **Progress Indicators**: Show live token count, speed, and chunk progress
- **Streaming Controls**: Enable pause/resume/stop functionality
- **Error Recovery**: Configure retry attempts (default: 3) and timeout (default: 30s)
- **Performance Metrics**: Display detailed streaming statistics in mindmap summaries

#### Timeout & Reliability

- **Connection Timeout**: Maximum time to wait for initial connection
- **Chunk Timeout**: Maximum time between data chunks (prevents stalled connections)
- **Retry Logic**: Automatic retry on network errors with exponential backoff

### Mindmap Settings

- **Layout Algorithm**: Choose from radial, hierarchical, organic, force-directed, or hybrid
- **Spacing**: Compact, normal, or spacious node arrangement
- **Color Coding**: Enable content-type based coloring
- **Max Split Notes**: Limit the number of nodes created (default: 6)

## Usage

1. Select a note in the canvas
2. Press Alt+Shift+G to generate new note from GPT using current note + ancestors
3. To create next note for responding, press Alt+Shift+N.

AI notes are colored purple, and tagged with `chat_role=assistant` in the canvas data file.

## Usage Examples

### Basic Streaming

1. Enable "Streaming" in plugin settings
2. Select a canvas node and press Alt+Shift+G
3. Watch the response appear in real-time with a streaming indicator (●)

### Advanced Streaming with Controls

1. Enable "Streaming Controls" and "Progress Indicators"
2. During streaming, use the control panel to pause/resume/stop
3. Monitor real-time performance metrics

### Mindmap Generation

1. Use Alt+Shift+M for automatic mindmap generation
2. Long responses are intelligently split into connected nodes
3. Content is organized by type with color coding

## Development

1. Download source and install dependencies
   ```
   pnpm install
   ```
2. In Obsidian, install and enable [hot reload plugin](https://github.com/pjeby/hot-reload)
3. Create symbolic link from this project dir to an Obsidian store
   ```
   ln -s . your-obsidian-store/.obsidian/plugins/chat-stream
   ```
4. Start dev server
   ```
   pnpm run dev
   ```
5. In Obsidian, enable Chat Stream Plugin and add OpenAI key in plugin settings.

Changes to code should automatically be loaded into Obsidian.

## Attribution

- Canvas plugin code from [Canvas MindMap](https://github.com/Quorafind/Obsidian-Canvas-MindMap)

## Say thanks

If you love it you can send me a [coffee thumbs-up](https://bmc.link/ryanp) so I know folks find it useful.

<a href="https://www.buymeacoffee.com/ryanp"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=ryanp&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff" /></a>

Stream chat with AI models in Obsidian Canvas, with support for both OpenAI and Google Gemini models.

## Features

This plugin enables AI-powered canvas note creation with advanced mindmap capabilities and an intuitive tooltip interface:

### Core Features

- **Canvas Note Generation**: Create AI responses as connected notes on Obsidian Canvas
- **Streaming Responses**: Real-time AI response streaming with live updates
- **Hierarchical Mindmaps**: Automatically split AI responses into structured hierarchical notes
- **Conversation Context**: Build conversational threads by connecting related notes
- **Multiple AI Providers**: Support for OpenAI GPT models and Google Gemini

### Interactive Tooltip Interface

When you select a note on the canvas, a tooltip appears in the upper right corner with three icon buttons:

- **🌳 Hierarchical Mindmap** (`git-branch` icon): Creates a hierarchical tree structure from the selected note using headers and subheaders
- **⭕ Radial Mindmap** (`circle-dot` icon): Generates a radial layout with multiple topic branches extending from the central concept
- **💬 Single AI Response** (`message-square` icon): Creates a focused AI response without chunking or splitting

### Advanced Features

- **Header-Based Splitting**: Automatically parse markdown headers to create structured note hierarchies
- **Markdown Processing**: Intelligent content splitting with configurable chunk sizes and overlap
- **Live Tree Visualization**: Real-time display of hierarchical structures as content streams
- **Custom System Prompts**: Define conversation context and AI behavior
- **Token Management**: Monitor and control token usage for cost optimization

## Keyboard Shortcuts

- **Generate AI note** (`Alt+Shift+G`): Generate AI response based on conversation context
- **Generate AI mindmap** (`Alt+Shift+M`): Create mindmap-style AI responses
- **Split markdown into hierarchical notes** (`Alt+Shift+S`): Transform markdown into hierarchical structures
- **Generate hierarchical mindmap** (`Alt+Shift+H`): Create structured hierarchical mindmap
- **Generate radial mindmap** (`Alt+Shift+R`): Create radial layout mindmap
- **Generate single AI response** (`Alt+Shift+A`): Create focused single-note response

## Latest Updates

### Enhanced Streaming Experience 🚀

- **Real-time Progress Tracking**: Live token count, streaming speed, and chunk progress
- **Streaming Controls**: Pause, resume, and stop streaming operations
- **Error Recovery**: Automatic retry with configurable attempts and timeout handling
- **Performance Metrics**: Detailed streaming statistics and performance analysis
- **Robust Connection Handling**: Timeout protection and stalled connection detection

### Gemini 2.5 Models Support ✨

- **Gemini 2.5 Flash**: Best price-performance model with 1M token context window
- **Gemini 2.5 Pro**: Most advanced reasoning model for complex tasks and coding

### Enhanced Mindmap Visualization 🎨

- Smart content-based color coding
- Improved spatial layouts and organization
- Customizable color themes and spacing
- Better typography and visual hierarchy
- Smooth hover effects and animations

## D3.js Force Simulation Integration

The plugin now uses D3.js's advanced force simulation for the force-directed layout algorithm, providing:

### Features

- **Advanced Physics**: Sophisticated force calculations for natural node positioning
- **Content-Aware Grouping**: Nodes are grouped by content type (algorithms, code, steps, etc.)
- **Adaptive Collision Detection**: Based on actual node dimensions and importance
- **Performance Optimized**: Efficient simulation with early stopping conditions

### Force Types

1. **Charge Force**: Repulsion between nodes, stronger for larger/more important nodes
2. **Collision Force**: Prevents overlapping based on node dimensions
3. **Centering Force**: Gentle attraction to center, weaker for important nodes
4. **Content Grouping**: Groups similar content types together
5. **Radial Force**: Prevents clustering too close to the center

### Configuration

The simulation respects your mindmap spacing settings:

- **Compact**: Tighter spacing with reduced force multipliers
- **Normal**: Balanced spacing (default)
- **Spacious**: Wider spacing with increased force multipliers

### Content Type Positioning

Different content types are positioned at specific angles:

- **Algorithms**: 0° - 45° (top-right quadrant)
- **Code**: 90° (right)
- **Steps/Lists**: 180° - 225° (bottom-left)
- **Examples**: 270° (bottom)
- **Important/Summary**: 315° - 360° (top-left)

## New: Langchain Recursive Markdown Splitter

Transform your AI responses and markdown documents into hierarchical, interconnected knowledge structures:

#### How It Works

The plugin uses Langchain's RecursiveCharacterTextSplitter to intelligently split markdown content based on header hierarchy:

```
# Header 1 - Root
## Header 2 - Child1, child of Root
### Header 3 - Child2, child of Child1
#### Header 4 - Child3, child of Child2
##### Header 5 - Child4, child of Child3
###### Header 6 - Child5, child of Child4
```

#### Features

- **Smart Chunking**: Respects header boundaries and maintains context
- **Visual Hierarchy**: Creates parent-child relationships with directed edges
- **Configurable Settings**: Customize chunk size, overlap, and spacing
- **Tree Visualization**: Optional structure overview display
- **Canvas Integration**: Automatically positions nodes based on hierarchy level

#### Usage

1. **Enable in Settings**: Go to plugin settings → Markdown Splitting section
2. **Prepare Content**: Create or select a note with markdown headers
3. **Split Content**: Use command "Split markdown into hierarchical notes" or `Alt+Shift+S`
4. **Explore Structure**: Navigate the generated hierarchical note structure

#### Configuration Options

- **Chunk Size**: Maximum characters per chunk (default: 1000)
- **Chunk Overlap**: Characters to overlap for context (default: 200)
- **Keep Separators**: Preserve header markers (default: true)
- **Hierarchy Spacing**: Horizontal spacing between levels (default: 300px)
- **Enable Hierarchy**: Create parent-child edges (default: true)
- **Show Tree Visualization**: Display structure overview (default: true)

## Installation

This plugin is not yet available in the Obsidian Community Plugins directory. To install:

1. Download the latest release
2. Extract to your `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian settings

## Commands

- **Create next note** (`Alt+Shift+N`): Create a new note connected to the current selection
- **Generate AI note** (`Alt+Shift+G`): Generate AI response based on conversation context
- **Generate AI mindmap** (`Alt+Shift+M`): Create mindmap-style AI responses
- **Split markdown into hierarchical notes** (`Alt+Shift+S`): Transform markdown into hierarchical structures

## Setup

1. Install the plugin
2. Configure your API keys in plugin settings:
   - OpenAI API key for GPT models
   - Google Gemini API key for Gemini models
3. Choose your preferred AI model and provider
4. Configure markdown splitting settings if desired
5. Start creating AI-powered canvas notes!

## AI Providers Supported

- **OpenAI**: GPT-3.5, GPT-4, and other chat completion models
- **Google Gemini**: Gemini Pro and other Gemini models

## Requirements

- Obsidian v1.4.11 or higher
- Valid API key for your chosen AI provider
- Canvas plugin enabled in Obsidian

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions welcome! Please read the contributing guidelines and submit pull requests for any improvements.

---

**Note**: This plugin uses internal Obsidian Canvas APIs that may change without notice. The plugin is designed to work with the current version of Obsidian but may require updates for future versions.
