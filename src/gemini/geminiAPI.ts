import { request, RequestUrlParam } from 'obsidian'
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, FinishReason } from '@google/generative-ai'

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
	maxOutputTokens: 8192
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
 * Real streaming completion for Gemini using the official SDK
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
		console.log('getGeminiStreamingCompletion called with real streaming')
		console.debug('Calling Gemini streaming (real)', { model, messagesCount: messages.length })

		const genAI = new GoogleGenerativeAI(apiKey)
		const geminiModel = genAI.getGenerativeModel({
			model: model || GEMINI_MODELS.GEMINI_1_5_FLASH.name,
			generationConfig: {
				...defaultGeminiSettings,
				...settings
			},
			safetySettings: [
				{
					category: HarmCategory.HARM_CATEGORY_HARASSMENT,
					threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
				},
				{
					category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
					threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
				},
				{
					category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
					threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
				},
				{
					category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
					threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
				},
			],
		})

		// Handle system prompt by prepending it to the first user message
		const systemPrompt = messages.find(msg => msg.role === 'system')?.content
		const conversationMessages = messages.filter(msg => msg.role !== 'system')

		let prompt = ''
		if (systemPrompt && conversationMessages.length > 0) {
			const firstUserMessage = conversationMessages.find(msg => msg.role === 'user')
			if (firstUserMessage) {
				prompt = `${systemPrompt}\n\n${firstUserMessage.content}`
			} else {
				prompt = conversationMessages[0]?.content || ''
			}
		} else {
			// If no system prompt, use the last user message or combine all messages
			const userMessages = conversationMessages.filter(msg => msg.role === 'user')
			prompt = userMessages[userMessages.length - 1]?.content || conversationMessages[conversationMessages.length - 1]?.content || ''
		}

		console.log('Streaming prompt:', prompt)

		// Start the real streaming
		const streamingResult = await geminiModel.generateContentStream([prompt])

		let fullText = ''
		let isComplete = false

		for await (const chunk of streamingResult.stream) {
			try {
				// Process the text content if available
				const chunkText = chunk.text()
				if (chunkText) {
					fullText += chunkText
					onToken(chunkText)
				}

				// Check for completion indicators for logging purposes
				const candidate = chunk.candidates?.[0]
				if (candidate?.finishReason) {
					const finishReason = candidate.finishReason
					console.debug('Gemini streaming chunk with finish reason:', finishReason)

					if (finishReason !== FinishReason.STOP) {
						console.warn('Gemini streaming finished with reason:', finishReason)
						if (finishReason === FinishReason.SAFETY) {
							console.warn('Content was blocked due to safety concerns')
						} else if (finishReason === FinishReason.RECITATION) {
							console.warn('Content was blocked due to recitation concerns')
						} else if (finishReason === FinishReason.MAX_TOKENS) {
							console.warn('Content was truncated due to length limits')
						}
					}

					// Mark completion but don't break - let stream end naturally
					isComplete = true
				}
			} catch (chunkError) {
				console.warn('Error processing chunk:', chunkError)
				// Continue processing other chunks
			}
		}

		// Log completion status
		console.log('Gemini streaming completed naturally, completion status:', isComplete ? 'finished with reason' : 'natural end')
		onComplete(fullText)
		console.log('Real streaming completed, full text length:', fullText.length)

	} catch (error) {
		console.error('Gemini streaming error:', error)

		let errorMessage = 'Error streaming from Gemini.'
		if (error instanceof Error) {
			errorMessage += ` ${error.message}`
		}

		// Check for specific Gemini API error structure
		if (error && typeof error === 'object' && 'message' in error) {
			const gError = error as any
			if (gError.message) {
				errorMessage = `Gemini API Error: ${gError.message}`
				if (gError.message.includes('API key not valid')) {
					errorMessage += ' Please check your API key in settings.'
				} else if (gError.message.includes('RECITATION')) {
					errorMessage += ' Content was blocked due to recitation. Try rephrasing your prompt.'
				} else if (gError.message.includes('SAFETY')) {
					errorMessage += ' Content was blocked by safety filters. Try rephrasing your prompt.'
				}
			}
		}

		onError(new Error(errorMessage))
	}
}
