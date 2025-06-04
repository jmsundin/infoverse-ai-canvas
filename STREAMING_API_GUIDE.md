# Enhanced Streaming API Guide

This document explains the new streaming capabilities added to the Infoverse AI Canvas project for both OpenAI and Gemini providers.

## OpenAI Streaming Functions

### 1. `getChatGPTStreamingCompletion` (Original)

The original streaming implementation using Server-Sent Events with fetch API.

```typescript
import { getChatGPTStreamingCompletion } from './src/openai/chatGPT'

await getChatGPTStreamingCompletion(
	apiKey,
	apiUrl,
	model,
	messages,
	(token) => {
		// Handle each token as it arrives
		console.log('Token:', token)
	},
	(fullText) => {
		// Handle completion
		console.log('Complete:', fullText)
	},
	(error) => {
		// Handle errors
		console.error('Error:', error)
	},
	settings, // Optional settings
	30000 // Optional timeout in ms
)
```

### 2. `getChatGPTStreamingCompletionWithSDK` (New)

Enhanced streaming with official OpenAI SDK and typewriter effect.

```typescript
import { getChatGPTStreamingCompletionWithSDK } from './src/openai/chatGPT'

await getChatGPTStreamingCompletionWithSDK(
	apiKey,
	apiUrl,
	model,
	messages,
	(token) => {
		// Each token arrives with typewriter timing
		displayToken(token)
	},
	(fullText) => {
		// Complete text when done
		console.log('Finished:', fullText)
	},
	(error) => {
		// Enhanced error handling
		console.error('SDK Error:', error)
	},
	settings,
	{
		enabled: true, // Enable/disable typewriter effect
		speed: 20, // Milliseconds between characters
		chunkSize: 1 // Characters per chunk
	}
)
```

### 3. `getChatGPTWebSocketStyleStreaming` (New)

Ultra-responsive streaming with WebSocket-like characteristics.

```typescript
import { getChatGPTWebSocketStyleStreaming } from './src/openai/chatGPT'

await getChatGPTWebSocketStyleStreaming(
	apiKey,
	apiUrl,
	model,
	messages,
	(token) => {
		// Immediate token delivery
		updateUI(token)
	},
	(fullText) => {
		// Completion handler
		finalize(fullText)
	},
	(error) => {
		// Error handler
		handleError(error)
	},
	(progress) => {
		// Optional progress tracking
		console.log(`Tokens: ${progress.tokens}/${progress.estimatedTotal}`)
	},
	settings
)
```

## Gemini Streaming Functions

### `getGeminiStreamingCompletion` (Enhanced)

Real streaming using the official Google Generative AI SDK.

```typescript
import { getGeminiStreamingCompletion } from './src/gemini/geminiAPI'

await getGeminiStreamingCompletion(
	apiKey,
	model,
	messages,
	(token) => {
		// Real-time token delivery from Gemini
		console.log('Gemini token:', token)
	},
	(fullText) => {
		// Complete response
		console.log('Gemini complete:', fullText)
	},
	(error) => {
		// Enhanced error handling with API-specific messages
		console.error('Gemini error:', error)
	},
	settings // Optional generation config
)
```

## Key Features

### Typewriter Effect (OpenAI SDK)

- **Smooth character-by-character display**
- **Configurable speed and chunk size**
- **Can be disabled for immediate display**
- **Handles async token buffering**

### WebSocket-Style Streaming (OpenAI)

- **Maximum responsiveness**
- **Progress tracking**
- **Heartbeat monitoring**
- **Ultra-low latency token delivery**

### Real Streaming (Gemini)

- **Actual streaming instead of simulation**
- **Official SDK integration**
- **Better error handling**
- **Safety settings included**

## Usage Examples

### Simple Typewriter Chat

```typescript
// OpenAI with typewriter effect
await getChatGPTStreamingCompletionWithSDK(
	apiKey,
	'https://api.openai.com/v1/chat/completions',
	'gpt-4o',
	[{ role: 'user', content: 'Write a story' }],
	(token) => (textElement.textContent += token),
	(full) => console.log('Story complete!'),
	(err) => showError(err),
	{ max_tokens: 500 },
	{ speed: 15, chunkSize: 1 }
)
```

### Real-time Gemini Streaming

```typescript
// Gemini with real streaming
await getGeminiStreamingCompletion(
	apiKey,
	'gemini-1.5-flash',
	[{ role: 'user', content: 'Explain quantum physics' }],
	(token) => appendToDisplay(token),
	(full) => markComplete(),
	(err) => handleError(err),
	{ temperature: 0.7, maxOutputTokens: 1000 }
)
```

### WebSocket-Style with Progress

```typescript
// Ultra-responsive OpenAI streaming
await getChatGPTWebSocketStyleStreaming(
	apiKey,
	apiUrl,
	'gpt-4o',
	messages,
	(token) => updateDisplay(token),
	(full) => finishStream(full),
	(err) => showError(err),
	(progress) => updateProgressBar(progress.tokens, progress.estimatedTotal),
	settings
)
```

## Benefits

1. **Real Streaming**: Both providers now use actual streaming instead of simulation
2. **Enhanced UX**: Typewriter effects create engaging user experiences
3. **Better Error Handling**: Provider-specific error messages and suggestions
4. **Flexible Configuration**: Multiple streaming modes for different use cases
5. **Performance**: Optimized for responsiveness and efficiency
6. **Backward Compatibility**: Original functions still available

## Migration Guide

### From Simulated to Real Streaming

Replace:

```typescript
// Old simulated Gemini streaming
getGeminiStreamingCompletion(...)
```

With:

```typescript
// New real Gemini streaming (same function name, enhanced implementation)
getGeminiStreamingCompletion(...)
```

### Adding Typewriter Effects

```typescript
// Standard streaming
getChatGPTStreamingCompletion(...)

// Typewriter streaming
getChatGPTStreamingCompletionWithSDK(..., {
  enabled: true,
  speed: 25,
  chunkSize: 1
})
```

### Maximum Responsiveness

```typescript
// For the most responsive experience
getChatGPTWebSocketStyleStreaming(...)
```

## Error Handling

All functions provide enhanced error messages:

- **API Key Issues**: Specific guidance for authentication problems
- **Rate Limits**: Clear indication when limits are exceeded
- **Network Problems**: Detailed network error information
- **Timeout Handling**: Configurable timeouts with clear error messages

## Performance Considerations

- **Typewriter Effect**: Adds slight delay but improves UX
- **WebSocket-Style**: Maximum performance, minimal delays
- **Real Streaming**: Better than simulation, optimal bandwidth usage
- **Memory Usage**: Efficient token handling and buffering
