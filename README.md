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

- **Multiple AI Providers**: Support for OpenAI (GPT models) and Google Gemini models
- **Model Selection**: Choose from various models including:
  - OpenAI: GPT-3.5 Turbo, GPT-4, GPT-4 Turbo, GPT-4o, etc.
  - Google Gemini: Gemini 1.5 Pro, Gemini 1.5 Flash, **Gemini 2.5 Flash**, **Gemini 2.5 Pro** (NEW!)
- **Canvas Integration**: Create AI conversations directly in Obsidian Canvas
- **Smart Mindmaps**: Automatically generate visually organized mindmap responses
  - Enhanced visual layout with cross/diamond patterns for small mindmaps
  - Radial layouts for larger mindmaps with better spacing
  - Color-coded content types (code, lists, highlights)
  - Customizable themes and spacing options
- **System Prompts**: Define custom system prompts for specialized AI behavior
- **Context Awareness**: AI can read and respond to parent notes in the canvas
- **Auto-splitting**: Automatically break long responses into organized, connected notes
- **Streaming Response**: Real-time response generation
- **Token Management**: Configurable input/output token limits and depth control

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
