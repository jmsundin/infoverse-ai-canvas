import { CHAT_MODELS, OPENAI_COMPLETIONS_URL } from 'src/openai/chatGPT'
import { GEMINI_MODELS } from 'src/gemini/geminiAPI'
import { ALL_MODELS } from 'src/models/providers'

export interface ChatStreamSettings {
	/**
	 * The API key to use when making requests (deprecated - use provider-specific keys)
	 */
	apiKey: string

	/**
	 * The OpenAI API key
	 */
	openaiApiKey: string

	/**
	 * The Gemini API key
	 */
	geminiApiKey: string

	/**
	 * The URL endpoint for chat
	 */
	apiUrl: string

	/**
	 * The GPT model to use
	 */
	apiModel: string

	/**
	 * The provider (OpenAI or Gemini)
	 */
	provider: string

	/**
	 * Last selected OpenAI model (for restoring when switching back)
	 */
	lastOpenAIModel: string

	/**
	 * Last selected Gemini model (for restoring when switching back)
	 */
	lastGeminiModel: string

	/**
	 * The temperature to use when generating responses (0-2). 0 means no randomness.
	 */
	temperature: number

	/**
	 * The system prompt sent with each request to the API
	 */
	systemPrompt: string

	/**
	 * Enable debug output in the console
	 */
	debug: boolean

	/**
	 * The maximum number of tokens to send (up to model limit). 0 means as many as possible.
	 */
	maxInputTokens: number

	/**
	 * The maximum number of tokens to return from the API. 0 means no limit. (A token is about 4 characters).
	 */
	maxResponseTokens: number

	/**
	 * The maximum depth of ancestor notes to include. 0 means no limit.
	 */
	maxDepth: number

	/**
	 * Automatically split AI responses into multiple logical notes (mindmap style)
	 */
	enableAutoSplit: boolean

	/**
	 * Maximum number of notes to create when auto-splitting (prevents too many small notes)
	 */
	maxSplitNotes: number

	/**
	 * Color theme for mindmap nodes (1-6 for different colors)
	 */
	mindmapColorTheme: string

	/**
	 * Enable different colors for different types of content in mindmap
	 */
	enableMindmapColorCoding: boolean

	/**
	 * Mindmap node spacing/layout density (compact, normal, spacious)
	 */
	mindmapSpacing: 'compact' | 'normal' | 'spacious'

	/**
	 * Mindmap layout algorithm (radial, hierarchical, organic, force)
	 */
	mindmapLayoutAlgorithm: 'radial' | 'hierarchical' | 'organic' | 'force'

	/**
	 * Enable streaming mode for real-time response display
	 */
	enableStreaming: boolean

	/**
	 * Auto-split responses while streaming (creates new nodes as content flows)
	 */
	enableStreamingSplit: boolean

	/**
	 * Update interval for streaming text display (milliseconds)
	 */
	streamingUpdateInterval: number

	/**
	 * Minimum chunk size before creating a new node when streaming and splitting
	 */
	streamingChunkSize: number

	/**
	 * Show streaming progress indicators (token count, speed, etc.)
	 */
	showStreamingProgress: boolean

	/**
	 * Enable pause/resume functionality during streaming
	 */
	enableStreamingControls: boolean

	/**
	 * Auto-retry on streaming errors (number of retries)
	 */
	streamingRetryAttempts: number

	/**
	 * Timeout for streaming requests in milliseconds
	 */
	streamingTimeout: number

	/**
	 * Enable streaming performance metrics and debugging
	 */
	enableStreamingMetrics: boolean
}

export const DEFAULT_SYSTEM_PROMPT = `
You are a critical-thinking assistant bot.
Consider the intent of my questions before responding.
Do not restate my information unless I ask for it.
Do not include caveats or disclaimers.
Use step-by-step reasoning. Be brief.
`.trim()

export const DEFAULT_SETTINGS: ChatStreamSettings = {
	apiKey: '',
	openaiApiKey: '',
	geminiApiKey: '',
	apiUrl: OPENAI_COMPLETIONS_URL,
	apiModel: CHAT_MODELS.GPT_35_TURBO.name,
	provider: 'OpenAI',
	lastOpenAIModel: CHAT_MODELS.GPT_35_TURBO.name,
	lastGeminiModel: '',
	temperature: 1,
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	debug: false,
	maxInputTokens: 0,
	maxResponseTokens: 0,
	maxDepth: 0,
	enableAutoSplit: false,
	maxSplitNotes: 6,
	mindmapColorTheme: '6',
	enableMindmapColorCoding: false,
	mindmapSpacing: 'normal',
	mindmapLayoutAlgorithm: 'organic',
	enableStreaming: true,
	enableStreamingSplit: false,
	streamingUpdateInterval: 500,
	streamingChunkSize: 100,
	showStreamingProgress: false,
	enableStreamingControls: false,
	streamingRetryAttempts: 3,
	streamingTimeout: 10000,
	enableStreamingMetrics: false
}

export function getModels() {
	return ALL_MODELS.map(model => ({
		name: model.name,
		provider: model.provider
	}))
}

export function getModelsByProvider(provider: string) {
	if (provider === 'OpenAI') {
		return Object.values(CHAT_MODELS).map(model => model.name)
	} else if (provider === 'Gemini') {
		return Object.values(GEMINI_MODELS).map(model => model.name)
	}
	return []
}
