import { request, RequestUrlParam } from 'obsidian'

export const GEMINI_COMPLETIONS_URL = `https://generativelanguage.googleapis.com/v1beta/models`

export type GeminiModelSettings = {
	name: string,
	tokenLimit: number,
	encodingFrom?: string
}

export const GEMINI_MODELS = {
	GEMINI_1_5_PRO: {
		name: 'gemini-1.5-pro',
		tokenLimit: 128000,
		encodingFrom: 'gemini-1.5-pro'
	},
	GEMINI_1_5_FLASH: {
		name: 'gemini-1.5-flash',
		tokenLimit: 128000,
		encodingFrom: 'gemini-1.5-flash'
	},
	GEMINI_2_5_FLASH: {
		name: 'gemini-2.5-flash-preview-05-20',
		tokenLimit: 1048576, // 1M input tokens
		encodingFrom: 'gemini-2.5-flash'
	},
	GEMINI_2_5_PRO: {
		name: 'gemini-2.5-pro-preview-05-06',
		tokenLimit: 1048576, // 1M input tokens
		encodingFrom: 'gemini-2.5-pro'
	}
}

export type GeminiModel = keyof typeof GEMINI_MODELS

export function geminiModelByName(name: string) {
	return Object.values(GEMINI_MODELS).find((model) => model.name === name)
}

// Gemini API types
export interface GeminiMessage {
	role: 'user' | 'model'
	parts: Array<{ text: string }>
}

export interface GeminiRequest {
	contents: GeminiMessage[]
	generationConfig?: {
		temperature?: number
		topP?: number
		topK?: number
		maxOutputTokens?: number
		stopSequences?: string[]
	}
	safetySettings?: Array<{
		category: string
		threshold: string
	}>
}

export interface GeminiResponse {
	candidates: Array<{
		content: {
			parts: Array<{ text: string }>
			role: string
		}
		finishReason: string
		index: number
	}>
	usageMetadata?: {
		promptTokenCount: number
		candidatesTokenCount: number
		totalTokenCount: number
	}
}

export const defaultGeminiSettings = {
	temperature: 0.7,
	topP: 0.8,
	topK: 10,
	maxOutputTokens: 2048
}

// Convert OpenAI-style messages to Gemini format
function convertMessagesToGemini(messages: Array<{ role: string; content: string }>): GeminiMessage[] {
	return messages
		.filter(msg => msg.role !== 'system') // Gemini handles system prompts differently
		.map(msg => ({
			role: msg.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: msg.content }]
		}))
}

export async function getGeminiCompletion(
	apiKey: string,
	model: string,
	messages: Array<{ role: string; content: string }>,
	settings?: Partial<GeminiRequest['generationConfig']>
): Promise<string | undefined> {
	const modelName = model || GEMINI_MODELS.GEMINI_1_5_FLASH.name
	const url = `${GEMINI_COMPLETIONS_URL}/${modelName}:generateContent?key=${apiKey}`

	const headers = {
		'Content-Type': 'application/json'
	}

	// Handle system prompt by prepending it to the first user message
	const systemPrompt = messages.find(msg => msg.role === 'system')?.content
	const conversationMessages = messages.filter(msg => msg.role !== 'system')

	if (systemPrompt && conversationMessages.length > 0) {
		const firstUserMessage = conversationMessages.find(msg => msg.role === 'user')
		if (firstUserMessage) {
			firstUserMessage.content = `${systemPrompt}\n\n${firstUserMessage.content}`
		}
	}

	const body: GeminiRequest = {
		contents: convertMessagesToGemini(conversationMessages),
		generationConfig: {
			...defaultGeminiSettings,
			...settings
		}
	}

	const requestParam: RequestUrlParam = {
		url,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify(body),
		headers
	}

	console.debug('Calling Gemini', requestParam)

	try {
		const response = await request(requestParam)
		const res: GeminiResponse = JSON.parse(response)

		return res?.candidates?.[0]?.content?.parts?.[0]?.text
	} catch (err) {
		console.error('Gemini API error:', err)
		if (err.status === 429) {
			console.error('Gemini API rate limit exceeded.')
		}
		throw err
	}
}

/**
 * Streaming completion for Gemini with real-time token delivery
 * Note: Gemini API doesn't support true streaming like OpenAI, so we simulate it
 * by making the regular call and delivering chunks progressively
 */
export async function getGeminiStreamingCompletion(
	apiKey: string,
	model: string,
	messages: Array<{ role: string; content: string }>,
	onToken: (token: string) => void,
	onComplete: (fullText: string) => void,
	onError: (error: Error) => void,
	settings?: Partial<GeminiRequest['generationConfig']>
): Promise<void> {
	try {
		console.debug('Calling Gemini streaming (simulated)', { model, messagesCount: messages.length })

		// First get the complete response
		const fullText = await getGeminiCompletion(apiKey, model, messages, settings)

		if (!fullText) {
			onError(new Error('No response from Gemini API'))
			return
		}

		// Simulate streaming by delivering the text in chunks
		const chunkSize = 5 // Characters per chunk
		const delay = 50 // Milliseconds between chunks

		let currentIndex = 0

		const streamChunk = () => {
			if (currentIndex >= fullText.length) {
				onComplete(fullText)
				return
			}

			const chunk = fullText.slice(currentIndex, currentIndex + chunkSize)
			currentIndex += chunkSize

			onToken(chunk)
			setTimeout(streamChunk, delay)
		}

		// Start streaming
		streamChunk()

	} catch (error) {
		console.error('Gemini streaming error:', error)
		onError(error instanceof Error ? error : new Error(String(error)))
	}
}
